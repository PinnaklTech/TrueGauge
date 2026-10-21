# TheTruegage VPS update guide (Hostinger)

How to pull the latest code from GitHub and make backend + frontends live on the VPS.

**App path:** `/var/www/TrueGauge`  
**Branch:** `main`

## Architecture (what runs what)

| Domain | Serves | How it runs |
|--------|--------|-------------|
| `api.thetruegage.com` | FastAPI backend | Docker Compose (`docker-compose.prod.yml`) → `127.0.0.1:8000` |
| `app.thetruegage.com` | Customer app (TanStack Start) | systemd `truegauge-app.service` → `127.0.0.1:3000` (nginx proxies) |
| `admin.thetruegage.com` | Master admin UI | Static files from `master-admin/dist` (nginx) |

- Postgres + API + reminder worker: Docker (`restart: unless-stopped`)
- Customer app: systemd (not PM2)
- Nginx: TLS + reverse proxy / static hosting

## Full update (copy-paste)

SSH into the VPS, then run:

```bash
cd /var/www/TrueGauge

# 1) Match GitHub (discards local edits on the VPS)
git fetch origin
git reset --hard origin/main
git clean -fd
git status

# 2) Backend — rebuild & restart Docker (API + reminder worker; migrations run on API start)
docker compose -f docker-compose.prod.yml up -d --build

# 3) Frontends — required env for production builds
export VITE_API_URL=https://api.thetruegage.com
export VITE_APP_URL=https://app.thetruegage.com

npm ci
npm run build          # customer app → .output/ (Node SSR)
npm run build:admin    # master admin → master-admin/dist/

# 4) Restart customer app + reload nginx
sudo systemctl restart truegauge-app.service
sudo systemctl status truegauge-app.service --no-pager
sudo nginx -t && sudo systemctl reload nginx
```

Then hard-refresh the browser (or use an incognito window) so old hashed JS/CSS are not cached.

## Verify

```bash
# Docker backend
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8000/api/health
curl -sI https://api.thetruegage.com/api/health | head

# Customer app (Node on :3000)
ss -tlnp | grep 3000
curl -sI http://127.0.0.1:3000/ | head
curl -sI https://app.thetruegage.com/ | head

# Admin static build
ls master-admin/dist/assets | head
curl -sI https://admin.thetruegage.com/ | head
```

## Notes

### Local VPS changes vs GitHub

`git reset --hard origin/main` makes the repo match GitHub and **discards** uncommitted edits on the server (e.g. local tweaks to `docker-compose.prod.yml`).

- `.env` and other **gitignored** files are kept (`git clean -fd` does not remove ignored files).
- Do **not** use `git clean -fdx` — that can delete `.env`.

Optional backup before reset:

```bash
cp docker-compose.prod.yml docker-compose.prod.yml.vps-backup
```

### Production Vite env

Builds fail without a real API URL (blocks localhost in the bundle):

```text
Production build blocked: set VITE_API_URL to https://api.thetruegage.com
```

Always export before `npm run build` / `npm run build:admin`:

```bash
export VITE_API_URL=https://api.thetruegage.com
export VITE_APP_URL=https://app.thetruegage.com
```

You can also keep `master-admin/.env.production` (see `master-admin/.env.production.example`), but the assert script still expects these in the shell environment.

### 404s on `styles-XXXX.css` / `index-XXXX.js`

Usually means HTML was updated but the Node app was not restarted (or the browser has a stale cache).

Fix: rebuild → `sudo systemctl restart truegauge-app.service` → hard refresh / incognito.

### Useful commands

```bash
# Backend logs
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 reminder-worker

# Customer app logs
sudo journalctl -u truegauge-app.service -n 100 --no-pager
sudo systemctl status truegauge-app.service

# Nginx
sudo nginx -t
sudo systemctl reload nginx
grep -R "root\|server_name\|proxy_pass" /etc/nginx/sites-enabled/
```

## Quick checklist

1. [ ] `git fetch` + `reset --hard origin/main`
2. [ ] `docker compose -f docker-compose.prod.yml up -d --build`
3. [ ] `export VITE_API_URL=...` and `VITE_APP_URL=...`
4. [ ] `npm ci` → `npm run build` → `npm run build:admin`
5. [ ] `systemctl restart truegauge-app.service`
6. [ ] `nginx -t && systemctl reload nginx`
7. [ ] Health checks + browser hard refresh
