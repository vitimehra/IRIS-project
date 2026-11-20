# Deploying VITIS

Host the participant UI on **Vercel** and the API on **Railway**. SQLite, generated
images, and the Inspider web all live on a **Railway volume** at `/data`.

```
Participant / experimenter browser
        │
        ▼
  Vercel  (frontend/, Vite)
        │  VITE_API_BASE_URL
        ▼
  Railway (backend/, FastAPI)  ← 1 replica only
        │
        └── Volume mounted at /data
              ├── vitis.sqlite
              ├── images/
              ├── inspider/          (source parquet + embeddings, needed once)
              └── inspider_vectors.npz
```

Do the backend first. The frontend needs the Railway URL at build time.

---

## What you need

1. This repository on GitHub (the branch you deploy is `master`).
2. A [Railway](https://railway.com) account that can attach volumes (Hobby or Pro).
3. A [Vercel](https://vercel.com) account. The free Hobby plan is enough.
4. API keys:
   - Anthropic (`ANTHROPIC_API_KEY`) — Claude, including web search
   - OpenAI (`OPENAI_API_KEY`) — images and embeddings
5. A **built Inspider web** with _real_ OpenAI embeddings. VITIS refuses a local/dev
   build. You need these five files from `inspider-web-KG-app/data`:

   | File               | Typical size | Role                                              |
   | ------------------ | ------------ | ------------------------------------------------- |
   | `nodes.parquet`    | ~2 MB        | verb nodes                                        |
   | `edges.parquet`    | ~8 MB        | similarity strands                                |
   | `clusters.parquet` | small        | cluster names                                     |
   | `embeddings.npz`   | ~126 MB      | verb vectors                                      |
   | `provenance.json`  | small        | must show `stages.03_embed.provider` = `"openai"` |

   If `python -m pipeline.build` has not been run with an OpenAI key in
   `inspider-web-KG-app`, stop and build that first. Uploading a mock web will
   boot the API but the Inspider condition will not work.

6. Two experimenter passwords.

---

## 1. Railway — create the backend service

1. Open [railway.com/new](https://railway.com/new).
2. Choose **Deploy from GitHub repo**. Authorize GitHub if asked.
3. Select this repository (`CreatED-Viti-Mehra-VITIS-Ideation-App`, or your fork).
4. Railway creates a project and a service from the repo. Open that service.
5. Go to **Settings**.
6. Under **Source**:
   - **Root Directory:** `backend`  
     (the folder that contains `app/`, `requirements.txt`, and `railway.json`)
   - **Branch:** `master` (or whichever branch you push)
7. Confirm **Build** is Nixpacks. `backend/railway.json` already sets:
   - start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - health check: `GET /api/health`
   - health-check timeout: **600 seconds** (first Inspider import is slow)
   - replicas: **1**
8. Click **Deploy** if a deploy did not start on its own. The first boot may
   warn that the Inspider web is missing. That is expected until step 3.

### 1b. Public URL

1. Still on the backend service, **Settings → Networking**.
2. Click **Generate Domain**.
3. Copy the URL, for example `https://vitis-backend-production.up.railway.app`.  
   No trailing slash. You will paste this into Vercel as `VITE_API_BASE_URL`.

Railway injects `$PORT`. Do not set `BACKEND_PORT` on Railway.

---

## 2. Railway — volume (database, images, Inspider files)

SQLite and images must survive deploys. Put them on a volume, not in the
container filesystem.

1. Open the project canvas.
2. Right-click empty space (or press **⌘K** / **Ctrl+K**) → **Add volume**.
3. Connect it to the **backend** service.
4. Set **Mount path** to exactly:

   ```
   /data
   ```

   Not `/app/data`. The env vars below use absolute `/data/...` paths.

5. Size: **5 GB** is enough for the web, the database, and fifteen participants'
   images. Live-resize later from the volume settings if the disk fills.
6. Save. Railway restarts the service so the mount appears.

**Do not raise replicas above 1.** SQLite on a volume cannot take two writers.
`railway.json` already pins `numReplicas` to 1; do not override it in Settings.

After the volume is attached you should see (empty at first):

| Path in the container        | What belongs there                                      |
| ---------------------------- | ------------------------------------------------------- |
| `/data/vitis.sqlite`         | SQLite database (created on boot)                       |
| `/data/images/`              | rendered PNGs                                           |
| `/data/inspider/`            | the five Inspider source files (you upload these)       |
| `/data/inspider_vectors.npz` | copied from `embeddings.npz` on first successful import |

---

## 3. Put the Inspider web on the volume

The volume is empty until you copy the five files into `/data/inspider/`.
Pick **one** method.

### Method A — dashboard (no CLI)

1. Open the backend service → **Console**.
2. The file browser is scoped to the container. Go to `/data`.
3. Create a folder `inspider`.
4. Upload:

   ```
   nodes.parquet
   edges.parquet
   clusters.parquet
   embeddings.npz
   provenance.json
   ```

5. Confirm they are visible as `/data/inspider/nodes.parquet`, and so on.

### Method B — Railway CLI

Install the [Railway CLI](https://docs.railway.com/cli), then from a machine
that already has the built web:

```bash
railway login
railway link          # pick the VITIS project and backend service
```

Volume paths in these commands are **relative to the volume root**, which is
`/data` in the container. So `/inspider/nodes.parquet` on the volume is
`/data/inspider/nodes.parquet` in the app.

```bash
# from inspider-web-KG-app/data  (the built web, not this repo)
railway volume files upload ./nodes.parquet      /inspider/nodes.parquet
railway volume files upload ./edges.parquet      /inspider/edges.parquet
railway volume files upload ./clusters.parquet   /inspider/clusters.parquet
railway volume files upload ./embeddings.npz     /inspider/embeddings.npz
railway volume files upload ./provenance.json    /inspider/provenance.json
railway volume files list /inspider
```

### After the files are there

Restart the backend (**Deployments → ⋯ → Restart**, or a no-op redeploy) so
startup can import the web into SQLite. Watch **Deployments → Logs** for:

```
[vitis] imported Inspider web: 23,268 verbs, … edges (text-embedding-3-large)
```

The first import copies `embeddings.npz` to `/data/inspider_vectors.npz` and
inserts every node and edge. Give it several minutes. If the log instead says
`WARNING: Inspider web not imported`, the path or `provenance.json` is wrong
(usually a mock build, or a missing parquet).

You only do this import once. Later deploys see the data already in SQLite and
skip it.

---

## 4. Railway — environment variables

Backend service → **Variables**. Add these. Use **Raw Editor** if you prefer
to paste the block, then fill in secrets.

| Variable                       | Value                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`                 | `sqlite:////data/vitis.sqlite` (four slashes after `sqlite:`)        |
| `IMAGE_DIR`                    | `/data/images`                                                       |
| `INSPIDER_DATA_DIR`            | `/data/inspider`                                                     |
| `AI_PROVIDER`                  | `real`                                                               |
| `ANTHROPIC_API_KEY`            | your Anthropic key                                                   |
| `ANTHROPIC_MODEL`              | `claude-opus-5` (creative tier: ideas and concepts)                  |
| `ANTHROPIC_MODEL_FAST`         | `claude-sonnet-5` (structuring, phenomena search, render prompts)    |
| `ANTHROPIC_CREATIVE_PURPOSES`  | `ideas_modern,ideas_inspider,concept`                                |
| `CLAUDE_WEB_SEARCH`            | `true`                                                               |
| `CLAUDE_WEB_SEARCH_MAX_USES`   | `3` (searches per phenomena call; the main cost lever)               |
| `OPENAI_API_KEY`               | your OpenAI key                                                      |
| `OPENAI_IMAGE_MODEL`           | `gpt-image-1`                                                        |
| `OPENAI_IMAGE_QUALITY_PRODUCT` | `medium`                                                             |
| `OPENAI_IMAGE_QUALITY_IN_USE`  | `low`                                                                |
| `OPENAI_EMBEDDING_MODEL`       | `text-embedding-3-large`                                             |
| `EMBEDDING_DIMENSIONS`         | `3072`                                                               |
| `SECRET_SALT`                  | a long random string, **set once and never change** (see below)      |
| `CORS_ORIGINS`                 | leave as `https://placeholder.vercel.app` until step 6, then replace |
| `NIXPACKS_PYTHON_VERSION`      | `3.12`                                                               |
| `GIT_LFS_SKIP_SMUDGE`          | `1` (do not pull the 126 MB embeddings into the build)               |
| `EXPERIMENTER_VITI_PASSWORD`   | used on first boot to create the `viti` console account              |
| `EXPERIMENTER_SANKAR_PASSWORD` | used on first boot to create the `sankar` console account            |

Generate `SECRET_SALT` locally (do not reuse the `.env.example` placeholder):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Saving variables triggers a redeploy. That is what you want.

Optional study knobs (defaults match a full session if you omit them):
`IDEAS_PER_CONDITION`, `CONCEPTS_PER_IDEA`, `KEYWORDS_PROPOSED`,
`NEIGHBOURS_SHOWN` (5), `NEIGHBOURS_MAX_PICK` (3), `PHENOMENA_PER_KEYWORD` (3),
`KEYWORDS_FINAL` (0 = one verb per idea), `KEYWORD_SWAPS_MAX` (1), `RENDER_IN_USE` (false),
`PARTICIPANT_TOKEN_TTL_HOURS`, `EXPERIMENTER_TOKEN_TTL_HOURS`, and the `PRICE_*`
list prices behind the console's cost meter (see `.env.example`). The defaults keep a
full participant at about $2.6; the Overview tab shows the measured figure.

---

## 5. Console accounts (automatic on first boot)

Set `EXPERIMENTER_VITI_PASSWORD` and `EXPERIMENTER_SANKAR_PASSWORD` in Railway
Variables **before** (or with) the first successful deploy. On startup the
backend creates `viti` and `sankar` if they are missing. It does not overwrite
existing accounts, so later deploys keep the hashes already in SQLite.

Watch deploy logs for:

```
[seed] created viti
[seed] created sankar
```

or `[seed] experimenter accounts already present`.

If both env vars were empty you will see `no experimenter accounts`. Set the
variables, restart the service, and they are created on the next boot.

To rotate a password later, set the env var and run:

```bash
railway ssh -- python -m app.seed
```

(`updated` means the hash in SQLite was rewritten.) Then you can delete the
plaintext variables from the dashboard.

Check the API:

```bash
curl https://<your-railway-domain>/api/health
```

You want `{"ok": true, "provider": "real"}`.

---

## 6. Vercel — frontend

1. Open [vercel.com/new](https://vercel.com/new).
2. **Import** the same GitHub repository.
3. Before deploying, set:

   | Setting              | Value                                              |
   | -------------------- | -------------------------------------------------- |
   | **Framework Preset** | Vite                                               |
   | **Root Directory**   | `frontend` (click **Edit** next to Root Directory) |
   | **Build Command**    | `npm run build` (default)                          |
   | **Output Directory** | `dist` (default)                                   |
   | **Install Command**  | `npm install` (default)                            |
   | **Node.js Version**  | 20.x (Settings → Build and Deployment, if offered) |

   `frontend/vercel.json` already rewrites every path to `index.html`, so
   `/console` and participant deep links work.

4. **Environment Variables** — add one variable for Production _and_ Preview:

   | Name                | Value                                                      |
   | ------------------- | ---------------------------------------------------------- |
   | `VITE_API_BASE_URL` | `https://<your-railway-domain>` with **no trailing slash** |

   Example: `https://vitis-backend-production.up.railway.app`

   Vite inlines this at **build** time. Changing it later requires a Redeploy
   with **Use existing Build Cache** turned **off**.

5. Click **Deploy**. When it finishes, copy the production URL, e.g.
   `https://vitis-ideation.vercel.app`.

6. Back on Railway → backend → **Variables**, set:

   ```
   CORS_ORIGINS=https://vitis-ideation.vercel.app
   ```

   No trailing slash. If you will use a custom domain, include both:

   ```
   CORS_ORIGINS=https://vitis-ideation.vercel.app,https://study.yourdomain.com
   ```

   Saving the variable redeploys the backend. Wait until that deploy is
   **Active** before logging into the console. A stale `CORS_ORIGINS` looks
   like a login that never returns.

---

## 7. Check that it actually works

1. Open `https://<vercel>/console`.
2. Sign in as `viti` or `sankar` with the password you seeded.
3. **Overview** should show `provider: real` and an Inspider web imported with
   `text-embedding-3-large` (on the order of 23k verbs, not zero).
4. Create a test participant, run the whole study on a phone and a laptop,
   confirm renders appear and the summary table fills, then delete that
   participant.
5. Download `ratings.csv` once and open it so you know the analysis table is
   right before real sessions.

Never point a real participant at a deploy with `AI_PROVIDER=mock`.

---

## 8. Custom domains (optional)

**Frontend (Vercel):** Project → Settings → Domains → add `study.yourdomain.com`
→ put the DNS records Vercel shows at your registrar → add that `https://…`
origin to `CORS_ORIGINS` on Railway → wait for the backend redeploy.

**API (Railway):** backend → Settings → Networking → Custom Domain. You do
**not** need this unless you want a pretty API host. If you add one, update
`VITE_API_BASE_URL` on Vercel and Redeploy the frontend (no build cache).

---

## Backups

Do both after every few participants. The volume is the only copy of the
study.

- **Metadata:** console → Export → `export.json` (everything except image
  bytes) and `ratings.csv`.
- **Images + database:** Railway CLI, paths relative to the volume root:

  ```bash
  railway volume files download /vitis.sqlite ./backup-vitis.sqlite
  railway volume files download /images ./backup-images
  railway volume files download /inspider_vectors.npz ./backup-inspider_vectors.npz
  ```

  Or use the volume file browser / **volume backups** in the Railway dashboard
  (Settings on the volume).

Restoring is the reverse: upload onto `/`, then restart the backend.

---

## Updating the app later

Push to `master`. Railway rebuilds `backend/`; Vercel rebuilds `frontend/`.
The volume is left alone, so participants, images, and the imported web stay.

If you change `VITE_API_BASE_URL`, Redeploy on Vercel with the build cache
disabled. If you change `CORS_ORIGINS` or `SECRET_SALT`, wait for the Railway
deploy to go Active. **Do not change `SECRET_SALT` after real sessions have
started** — existing tokens and password hashes become invalid.

---

## If something is wrong

| Symptom                                                       | Likely cause                                                 | Fix                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `/api/health` never becomes ready on first deploy             | Inspider import still running, or files missing              | Wait for the import log line; confirm `/data/inspider/*.parquet` exist; timeout is 600s in `railway.json` |
| Health is `ok` but Overview shows no verbs                    | Import warned and skipped                                    | `provenance.json` must be an OpenAI build; `INSPIDER_DATA_DIR=/data/inspider`; restart after uploading    |
| Console login hangs or CORS error in the browser              | `CORS_ORIGINS` does not exactly match the Vercel origin      | Include `https://…`, no trailing slash; wait for backend redeploy                                         |
| Frontend loads, every API call 404s                           | `VITE_API_BASE_URL` empty or wrong at build time             | Set it on Vercel for Production + Preview; Redeploy without cache                                         |
| `sqlite3.OperationalError` / database vanished after a deploy | Volume not mounted at `/data`, or `DATABASE_URL` is relative | Mount `/data`; `DATABASE_URL=sqlite:////data/vitis.sqlite`                                                |
| Images 404 after a redeploy                                   | `IMAGE_DIR` not on the volume                                | `IMAGE_DIR=/data/images`                                                                                  |
| Seed skips both users                                         | Password env vars missing on first boot                      | Set them and restart; accounts are created automatically                                                  |
| Two writers / `database is locked`                            | More than one replica                                        | Settings → replicas = 1                                                                                   |

---

## Postgres later (not required)

The volume + SQLite setup above is what this study uses. To move later:

1. Add a Postgres plugin in the same Railway project.
2. `pip install 'psycopg[binary]'` (add it to `backend/requirements.txt`).
3. Set `DATABASE_URL=postgresql+psycopg://…` to the plugin URL.
4. Boot once so SQLAlchemy creates tables. Migrate rows with pgloader (or
   equivalent). Images stay on the volume; only the SQLite file is replaced.

No model changes are needed — columns are portable types only.
