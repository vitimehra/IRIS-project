# Deploy UNFOLD

Frontend on Vercel. Backend and SQLite on Railway (with a volume).

You need accounts on GitHub, [Railway](https://railway.app), and [Vercel](https://vercel.com). Deploy the backend first, then the frontend, then go back to Railway to finish two URLs.

Do not commit `.env` files. `.gitignore` already excludes them.

---

## 1. Put the repo on GitHub

1. Confirm `git status` does **not** list `backend/.env` or `frontend/.env`.
2. Push `main` to GitHub.

```bash
git status
git push -u origin main
```

If the repo has no remote yet:

```bash
git remote add origin https://github.com/<you>/unfold-issue-identifier-app.git
git branch -M main
git push -u origin main
```

---

## 2. Generate a salt (once)

On your laptop:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. You will paste it as `IP_HASH_SALT`. Never change it after real participants start.

Also pick two researcher passwords (4 characters is enough). You will paste them as Railway variables in step 5.

---

## 3. Create the Railway backend

1. Open [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → select this repository.
3. Open the new service.
4. **Settings → Source / Root Directory** → set to `backend` → save. Redeploy if the first build used the repo root.
5. **Settings → Networking** → **Generate Domain**. Copy the URL. Example: `https://unfold-production.up.railway.app` (no trailing slash). This is the API URL.
6. **Settings → Replicas** → leave at **1**. Do not scale this service. SQLite will corrupt if two replicas write the same file. `backend/railway.json` already pins `numReplicas: 1`.

---

## 4. Attach the SQLite volume

Without this, every redeploy wipes the study data.

1. On the same Railway service: **Variables** is not the volume. Open **Settings → Volumes** (or right-click the canvas → **Add Volume**).
2. Attach a volume to this service.
3. Set the mount path to exactly:

```
/data
```

4. Redeploy the service so it starts with the volume mounted.

---

## 5. Set Railway environment variables

Service → **Variables**. Add these. Leave `CORS_ORIGINS` and `PUBLIC_APP_URL` as placeholders for now; you will replace them after Vercel gives you a URL.

| Variable                | Value                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`              | `production`                                                           |
| `DATABASE_PATH`         | `/data/unfold.sqlite`                                                  |
| `IP_HASH_SALT`          | the string from step 2                                                 |
| `CORS_ORIGINS`          | `https://placeholder.vercel.app`                                       |
| `PUBLIC_APP_URL`        | `https://placeholder.vercel.app`                                       |
| `LLM_ENABLED`           | `false` until you are ready to spend Anthropic credits, then `true`    |
| `ANTHROPIC_API_KEY`     | your key (can be empty while `LLM_ENABLED=false`)                      |
| `ANTHROPIC_MODEL`       | `claude-opus-5`                                                        |
| `ADMIN_VITI_PASSWORD`   | Viti's login password (4+ characters)                                  |
| `ADMIN_SANKAR_PASSWORD` | Sankar's login password (4+ characters)                                |

Optional: `ADMIN_VITI_EMAIL` and `ADMIN_SANKAR_EMAIL` if you want those stored on the researcher accounts.

Do **not** set `PORT`. Railway injects it.

The `ADMIN_*` passwords are applied automatically when the API starts. The running API never uses them to check a login — that uses the hashes in SQLite. Leave the variables set so the next deploy can create or rotate accounts. Never add them to Vercel.

Redeploy. Wait until the deploy is **Success**.

Check:

```bash
curl https://<your-service>.up.railway.app/api/health
```

You should get JSON with `"ok": true`. If this fails, fix Railway before touching Vercel.

---

## 6. Confirm the researcher accounts

There is no Railway Shell step. Setting the `ADMIN_*` variables in step 5 and waiting for a successful deploy is the seed.

1. Open the Railway service → latest deployment → **Logs**.
2. Look for `[seed] created viti` / `[seed] created sankar`, or `already up to date` / `updated` on later deploys.
3. If you see `not set, skipping`, the password variables are missing. Add them, save, wait for the automatic redeploy, and check the new logs.
4. To rotate a password later, change the Railway variable and redeploy. The new password is applied on boot.

Logins:

- username `viti`
- username `sankar`
- URL will be `https://<your-vercel-app>/admin` after step 7

---

## 7. Create the Vercel frontend

1. Open [vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New → Project** → import the **same** GitHub repo.
3. Before you click Deploy, set:

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Root Directory   | `frontend` (click Edit next to Root Directory) |
| Framework Preset | Vite                                           |
| Build Command    | `npm run build`                                |
| Output Directory | `dist`                                         |

4. **Environment Variables** → add one variable for Production, Preview, and Development:

| Variable            | Value                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `https://<your-service>.up.railway.app` (the Railway domain from step 3, no trailing slash) |

Anything starting with `VITE_` is baked into the public JS bundle. Never put `ANTHROPIC_API_KEY`, `IP_HASH_SALT`, or researcher passwords here.

5. Click **Deploy**. Wait for Success.
6. Copy the production URL. Example: `https://unfold.vercel.app` (no trailing slash).

---

## 8. Point Railway at the live frontend

Back on the Railway service → **Variables**. Replace the two placeholders:

| Variable         | Value                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL` | `https://<your-app>.vercel.app` (the Vercel production URL, **not** the Railway URL)                                                                                |
| `CORS_ORIGINS`   | that same Vercel URL. If you also test preview deploys, comma-separate them with no spaces, e.g. `https://unfold.vercel.app,https://unfold-git-main-you.vercel.app` |

`PUBLIC_APP_URL` is what goes inside the guardian QR code. If you point it at the API, every guardian link is broken.

Redeploy the Railway service. Wait for Success.

---

## 9. Check it works

1. Open `https://<your-app>.vercel.app`. The landing page should load.
2. Open `https://<your-service>.up.railway.app/api/health`. `"ok": true`.
3. In the browser, start a session as age 25, complete consent and demographics. If the browser console shows a CORS error, `CORS_ORIGINS` does not match the exact Vercel origin (scheme + host, no trailing slash).
4. Sign in at `https://<your-app>.vercel.app/admin` as `viti` or `sankar`.
5. Confirm the test session appears. Download the JSON export once so you know backups work.

Optional: set `LLM_ENABLED=true` on Railway only after `ANTHROPIC_API_KEY` is set, then redeploy.

---

## 10. Rules you must not break

1. Keep Railway replicas at **1**.
2. Keep the volume mounted at `/data` and `DATABASE_PATH=/data/unfold.sqlite`.
3. Never put secrets in Vercel `VITE_` variables.
4. The volume is not backed up for you. After real participants start, download JSON from `/admin` regularly.

If the database is empty after a redeploy, the volume is missing or `DATABASE_PATH` is wrong.
If the guardian QR opens a broken page, `PUBLIC_APP_URL` is the API instead of the Vercel app.
If the UI loads but API calls fail, `VITE_API_BASE_URL` is wrong or you changed it without redeploying Vercel (it is compiled in at build time).
If Railway fails on `better-sqlite3` / `node-gyp` / Python, the backend is pinned to Node 20 in `backend/nixpacks.toml`. Confirm the service **Root Directory** is `backend`, then redeploy.
