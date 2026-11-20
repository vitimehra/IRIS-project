# Data formats

Why each file is the format it is, what is in it, and how to query it without the app.

## Principles

- **Parquet is canonical.** Columnar, compressed, typed, and readable by pandas, Polars,
  DuckDB, R, Spark and Gephi (via GraphML export). Nothing here needs a server.
- **NPZ for the vectors.** They are one dense matrix, and NumPy's compressed `.npz` is the
  smallest thing that loads back in one line. float16 halves the size with no visible
  effect on cosine neighbours.
- **DuckDB for querying.** A single file that runs SQL over the Parquet at memory speed.
  It is derived: delete it and stage 06 rebuilds it in a second.
- **Everything is stamped.** `provenance.json` records model, dimensions, k, prompt
  versions, timings and token usage per stage. Two builds are never confused.

## Files

### `verbs.parquet` — stage 01

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | int32 | stable row index; every other file refers to it |
| `lemma` | string | the verb, lowercase, WordNet base form |
| `forms` | list\<string\> | inflections and phrasal forms seen in the sources (`rises`, `rose`, `rise up`) |
| `sources` | list\<string\> | which of the eight sources contained it |
| `source_count` | int | `len(sources)` |
| `in_wordnet` | bool | WordNet has it as a verb |
| `verbnet_classes` | list\<string\> | VerbNet 3.3 class ids, e.g. `escape-51.1-1` |
| `unverified` | bool | one source only *and* not in WordNet — probably scrape noise |

### `verbs_glossed.parquet` — stage 02

All of the above, plus:

| Column | Type | Meaning |
| --- | --- | --- |
| `gloss` | string | definition; first two WordNet senses joined with `;` |
| `gloss_source` | string | `wordnet`, `gpt`, or `none` |
| `synset_count` | int | how many verb senses WordNet lists — a polysemy measure |
| `zipf_frequency` | float | Zipf scale 0–7 from `wordfreq`; 4 ≈ once per 10k words |
| `embed_text` | string | exactly what was embedded: `rise: move upward; …` |

### `embeddings.npz` — stage 03

```python
import numpy as np
z = np.load("data/embeddings.npz", allow_pickle=True)
z["ids"]        # int32 [N]          matches verbs.id
z["lemmas"]     # object [N]
z["vectors"]    # float16 [N, D]     L2-normalised, so cosine = dot product
str(z["model"]), int(z["dimensions"]), bool(z["normalised"])
```

Similarity between any two verbs, without the app:

```python
v = z["vectors"].astype("float32")
i, j = list(z["lemmas"]).index("rise"), list(z["lemmas"]).index("climb")
float(v[i] @ v[j])
```

### `edges.parquet` — stage 04

| Column | Type | Meaning |
| --- | --- | --- |
| `src` | int32 | verb id |
| `dst` | int32 | its neighbour |
| `sim` | float32 | **cosine similarity, 1 = identical** |
| `rank` | int16 | 0 = closest neighbour of `src` |

Directed: `(a → b, rank 2)` and `(b → a, rank 40)` are both stored and both meaningful.
`k` rows per verb (default 50). The app's `edges_sym` view folds both directions and keeps
the max.

### `nodes.parquet`, `clusters.parquet` — stage 05

`nodes` = `verbs_glossed` plus:

| Column | Type | Meaning |
| --- | --- | --- |
| `x`, `y` | float32 | UMAP coordinates, scaled to roughly ±100 |
| `cluster_id` | int32 | Leiden community on the k-NN graph |
| `in_degree` | int32 | how many verbs list this one among their top-k — hubness |
| `pagerank` | float32 | weighted PageRank on the web |
| `size` | float32 | display radius, from frequency (1.0–3.0) |

`clusters`: `cluster_id, size, name, top_verbs, cx, cy, name_source`.

### `inspider.duckdb` — stage 06

Tables `nodes`, `edges`, `clusters`; view `edges_sym(a, b, sim)`. Indexed on lemma, cluster,
src, dst.

## Recipes

Top 10 strands of a verb:

```sql
SELECT b.lemma, e.sim FROM edges e
JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
WHERE a.lemma = 'rise' ORDER BY e.sim DESC LIMIT 10;
```

Hubs of the web — verbs most often counted as somebody's nearest:

```sql
SELECT lemma, in_degree, zipf_frequency FROM nodes
WHERE NOT unverified ORDER BY in_degree DESC LIMIT 20;
```

Mean strand strength per region:

```sql
SELECT c.name, COUNT(*) AS strands, ROUND(AVG(e.sim), 3) AS mean_sim
FROM edges e JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
JOIN clusters c ON c.cluster_id = a.cluster_id
WHERE a.cluster_id = b.cluster_id
GROUP BY c.name ORDER BY mean_sim DESC;
```

Load the whole web into NetworkX (fine at 23k; slow at 100k — use igraph there, as the
backend does):

```python
import pandas as pd, networkx as nx
nodes = pd.read_parquet("data/nodes.parquet")
edges = pd.read_parquet("data/edges.parquet")
g = nx.Graph()
g.add_nodes_from(nodes.id)
g.add_weighted_edges_from(edges[["src", "dst", "sim"]].itertuples(index=False))
```

Export the whole web for Gephi:

```python
from pipeline.config import Config
from pipeline.s06_index import export_graphml
export_graphml(Config(), "inspider.graphml")
```

## Scaling notes

| Verbs | `embeddings.npz` (3072-d f16) | `edges.parquet` (k=50) | RAM in the backend |
| --- | --- | --- | --- |
| 23k (this corpus) | ~120 MB | ~15 MB | ~400 MB |
| 100k | ~600 MB | ~60 MB | ~1.5 GB |

The k-NN stage is exact (FAISS `IndexFlatIP`): a few seconds at 23k, a few minutes at 100k
on CPU. UMAP is the slowest stage — under a minute at 23k, ten to twenty at 100k. Lower
`EMBEDDING_DIMENSIONS` to 1024 in `.env` to cut vector storage by two-thirds with a small
quality cost; it is applied at embedding time by the API, not by truncation afterwards.
