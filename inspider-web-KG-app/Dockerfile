FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-backend.txt .
RUN pip install --no-cache-dir -r requirements-backend.txt

COPY backend ./backend
COPY scripts/start-backend.sh ./scripts/start-backend.sh
COPY scripts/download_data.py ./scripts/download_data.py
RUN chmod +x ./scripts/start-backend.sh

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/data

EXPOSE 8000
CMD ["./scripts/start-backend.sh"]
