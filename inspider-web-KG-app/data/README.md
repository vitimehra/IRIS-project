# data/

Outputs of `python -m pipeline.build`. Everything here is rebuildable and git-ignored.

- `raw/` — cached downloads of the verb sources, so re-runs are offline
- `checkpoints/` — per-batch embedding checkpoints; a dropped run resumes from here
- `provenance.json` — what was built, with which model, dims, k, and when

See `docs/DATA.md` for every file's schema and query recipes.
