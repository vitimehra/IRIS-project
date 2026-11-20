"""
Step 6 - Package the web for querying: a DuckDB file over the Parquet outputs.

DuckDB gives millisecond SQL over the node and edge tables with no server to run,
and reads the Parquet files directly, so the Parquet remains the canonical,
portable form (pandas, Polars, Gephi via GraphML export, R - all read it).
"""
from __future__ import annotations

import duckdb
import pandas as pd

from .config import Config, Provenance


def run(cfg: Config) -> None:
    if cfg.duckdb_path.exists():
        cfg.duckdb_path.unlink()

    con = duckdb.connect(str(cfg.duckdb_path))
    con.execute(f"CREATE TABLE nodes AS SELECT * FROM read_parquet('{cfg.nodes_parquet.as_posix()}')")
    con.execute(f"CREATE TABLE edges AS SELECT * FROM read_parquet('{cfg.edges_parquet.as_posix()}')")
    con.execute(f"CREATE TABLE clusters AS SELECT * FROM read_parquet('{cfg.clusters_parquet.as_posix()}')")

    con.execute("CREATE INDEX idx_nodes_lemma ON nodes(lemma)")
    con.execute("CREATE INDEX idx_nodes_cluster ON nodes(cluster_id)")
    con.execute("CREATE INDEX idx_edges_src ON edges(src)")
    con.execute("CREATE INDEX idx_edges_dst ON edges(dst)")

    # A symmetric view: every edge both ways, best similarity kept. This is what
    # traversal queries want.
    con.execute(
        """
        CREATE VIEW edges_sym AS
        SELECT a, b, MAX(sim) AS sim FROM (
          SELECT src AS a, dst AS b, sim FROM edges
          UNION ALL
          SELECT dst AS a, src AS b, sim FROM edges
        ) GROUP BY a, b
        """
    )

    counts = {
        t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("nodes", "edges", "clusters")
    }
    con.close()

    Provenance.load(cfg).stamp(cfg, "06_index", tables=counts, path=str(cfg.duckdb_path))
    print(f"[06_index] duckdb {counts} -> {cfg.duckdb_path}")


def export_graphml(cfg: Config, out_path) -> None:
    """The whole web as GraphML, for Gephi or Cytoscape. Large at 100k nodes."""
    import networkx as nx

    nodes = pd.read_parquet(cfg.nodes_parquet)
    edges = pd.read_parquet(cfg.edges_parquet)
    g = nx.Graph()
    for row in nodes.itertuples():
        g.add_node(int(row.id), label=row.lemma, cluster=int(row.cluster_id), x=float(row.x), y=float(row.y))
    for row in edges.itertuples():
        g.add_edge(int(row.src), int(row.dst), weight=float(row.sim))
    nx.write_graphml(g, out_path)


if __name__ == "__main__":
    run(Config())
