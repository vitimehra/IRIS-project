#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-8000}"

mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/nodes.parquet" ]; then
  if [ -z "$DATA_TARBALL_URL" ]; then
    echo "No data in $DATA_DIR and DATA_TARBALL_URL is unset."
    echo "Upload nodes.parquet, edges.parquet, clusters.parquet, embeddings.npz, provenance.json"
    echo "to the Railway volume, or set DATA_TARBALL_URL to a .tar.gz of those files."
    exit 1
  fi
  python /app/scripts/download_data.py
  tar -xzf /tmp/inspider-data.tar.gz -C "$DATA_DIR"
  rm -f /tmp/inspider-data.tar.gz
  if [ ! -f "$DATA_DIR/nodes.parquet" ] && [ -f "$DATA_DIR/data/nodes.parquet" ]; then
    mv "$DATA_DIR/data/"* "$DATA_DIR/"
    rmdir "$DATA_DIR/data" 2>/dev/null || true
  fi
fi

exec python -m uvicorn backend.app:app --host 0.0.0.0 --port "$PORT"
