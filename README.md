# The Illusion of Novelty

Code for the IRIS National Fair 2026–27 project *The Illusion of Novelty* (Technology Enhances the Arts · 3D Modeling): an AI pipeline that runs from an everyday user issue to a rendered product concept.

| Folder | System | What it does |
|---|---|---|
| `unfold-issue-identifier-app/` | **UNFOLD** | A gamified day-reconstruction web app that surfaces everyday user issues and writes them as Cause–Affect–Effect (CAE) cards. React + Node.js + SQLite. |
| `inspider-web-KG-app/` | **Inspider web** | Builds and serves the knowledge graph of 23,268 English verbs (text-embedding-3-large, 50 nearest neighbours by cosine similarity, UMAP layout, Leiden clusters). Python pipeline + FastAPI + React. |
| `vitis-ideation-app/` | **VITIS** | Takes one issue through AOPC problem, PP ideas by three routes (Traditional, Modern AI, Inspider), OC concepts and product renders, with blind rating. React + FastAPI + SQLite. |

Each app has its own README with setup instructions.

## Not included

- `.env` files and API keys. Copy each app's `.env.example` to `.env` and add your own keys.
- Study databases (participant data), `node_modules`, Python virtual environments and build output.
- Large generated data: verb embeddings (`*.npz`, `*.npy`), the FAISS index and the DuckDB cache. Rebuild them with the Inspider pipeline (`inspider-web-KG-app/pipeline`). The small graph files (`nodes.parquet`, `edges.parquet`) are included.
