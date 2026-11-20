# Deploy Inspider Web

## Step 1

On your PC, open the project folder and confirm the graph is already built:

```powershell
Get-Item data\nodes.parquet, data\edges.parquet, data\clusters.parquet, data\embeddings.npz, data\provenance.json
```

If any file is missing, run `.\run.ps1` locally first and wait until it finishes. Do not continue until all five files exist.

## Step 2

Create accounts if you do not have them yet: GitHub, Railway, Vercel. The GitHub repo for this project must already exist and this machine must be able to `git push` to it.

## Step 3

Pack the five data files into one archive. Run this from the project root. The files must sit at the top of the archive, not inside a `data\` folder.

```powershell
cd data
tar -czf ..\inspider-data.tar.gz nodes.parquet edges.parquet clusters.parquet embeddings.npz provenance.json
cd ..
Get-Item inspider-data.tar.gz
```

The file should be about 130–150 MB. Leave it on disk; do not `git add` it.

## Step 4

Push the application code only.

```powershell
git status
```

Confirm `.env` and `inspider-data.tar.gz` are **not** staged. If `inspider-data.tar.gz` is listed, run `git restore --staged inspider-data.tar.gz` and make sure it is not committed. Then:

```powershell
git add -A
git status
git commit -m "Deploy wiring"
git push origin HEAD
```

If there is nothing to commit, just `git push origin HEAD`.

## Step 5

Create the GitHub Release that Railway will download.

1. Open the GitHub repo in the browser.
2. Click **Releases**.
3. Click **Draft a new release**.
4. Tag: `data-v1` (create the tag on this screen if it does not exist).
5. Title: `inspider-data`.
6. Attach `inspider-data.tar.gz` from Step 3.
7. Click **Publish release**.
8. Copy the asset download URL. It must look like this, with no extra path:

```
https://github.com/YOUR_USER/YOUR_REPO/releases/download/data-v1/inspider-data.tar.gz
```

If a `data-v1` release with that file already exists, copy that same URL and go to Step 6.

## Step 6

Create a GitHub Personal Access Token so Railway can read the private release.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**.
2. Classic token: enable the **`repo`** scope. Fine-grained token: select this exact repository and set **Contents** to **Read**.
3. Generate the token and copy it once. You will paste it only into Railway.

## Step 7

Create the Railway backend.

1. Open [railway.app](https://railway.app).
2. **New Project** → **Deploy from GitHub repo**.
3. Select this repository.
4. If Railway offers a second service for the frontend / Node, skip it. Keep **one** service: the Python API.

## Step 8

Set the Railway root directory.

1. Open the service → **Settings** → **Build**.
2. **Root Directory**: leave **empty**. Do not type `frontend` or `backend`.

## Step 9

Attach a volume.

1. Service → **Settings** / **Volumes** → **Add volume**.
2. Mount path: `/data`

## Step 10

Give the service enough RAM.

1. Service → **Settings** → **Resources**.
2. Memory: **1 GB**.

## Step 11

Add Railway variables. Open the service → **Variables** and create exactly these. Do not set `PORT`, `BACKEND_HOST`, or `OPENAI_API_KEY`.

| Name                | Value                        |
| ------------------- | ---------------------------- |
| `DATA_DIR`          | `/data`                      |
| `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app`    |
| `DATA_TARBALL_URL`  | the URL you copied in Step 5 |
| `GITHUB_TOKEN`      | the token from Step 6        |

Mark `GITHUB_TOKEN` as a secret.

## Step 12

Create the public API URL.

1. Service → **Settings** → **Networking** → **Generate Domain**.
2. Copy the HTTPS origin with **no trailing slash**, for example `https://something.up.railway.app`.

## Step 13

Wait for a successful deploy. Open **Deployments → View Logs**. You want, in order:

1. `Resolving release data-v1 via GitHub API...`
2. `Downloaded 141,030,010 bytes.` (size may differ slightly)
3. `Uvicorn running` / `[inspider] 23,268 verbs`

Then open these two URLs, replacing the host with Step 12:

```
https://YOUR-RAILWAY-DOMAIN/api/health
https://YOUR-RAILWAY-DOMAIN/api/meta
```

`/api/health` must return `{"ok":true}`. `/api/meta` must show `"provider":"openai"` and `"verbs":23268`. Do not start Vercel until this works.

If the log shows HTTP 404, the token cannot read this repo or `DATA_TARBALL_URL` is the release **page** (`/releases/tag/...`) instead of the asset URL from Step 5. Fix the variable and Redeploy.

If the process is killed, raise memory above 1 GB and Redeploy.

## Step 14

Create the Vercel frontend.

1. Open [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Import the **same** GitHub repo.
3. Before deploying, set:

| Setting          | Value           |
| ---------------- | --------------- |
| Framework Preset | Vite            |
| Root Directory   | `frontend`      |
| Build Command    | `npm run build` |
| Output Directory | `dist`          |
| Install Command  | `npm install`   |

Root Directory must be `frontend`, not `.` and not empty.

## Step 15

Add the Vercel environment variable **before** the production build.

1. On the import screen, or **Settings → Environment Variables**.
2. Key: `VITE_API_BASE`
3. Value: the Railway URL from Step 12, with **no trailing slash**
4. Enable **Production**, **Preview**, and **Development**.
5. Do not add `OPENAI_API_KEY`.

## Step 16

Click **Deploy**. Wait until the deployment is green.

If you already deployed once without `VITE_API_BASE`, set the variable from Step 15, then **Deployments → … → Redeploy** and turn **off** “Use existing build cache”.

Copy the Vercel URL, for example `https://your-project.vercel.app`.

## Step 17

On Railway → **Variables**, add:

| Name           | Value                                          |
| -------------- | ---------------------------------------------- |
| `CORS_ORIGINS` | the Vercel URL from Step 16, no trailing slash |

Keep `CORS_ORIGIN_REGEX` from Step 11. Let the service restart.

## Step 18

Open the Vercel URL. Search `rise`. In the browser Network tab, `/api/meta` and `/api/search` must be **200** against the Railway host.

The public app is the Vercel URL. Local development is unchanged: on your PC leave `VITE_API_BASE` empty and run `.\run.ps1`.
