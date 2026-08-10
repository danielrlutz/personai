# Deploy wave — ralph@debi9 (+ Soul News sidecar)

Copy-paste steps after `origin/main` includes the wave merges (Invoice naming, Drive knowledge / Frist kit, specialist agency, Jahresakte, sealed suitcase, Drive folder combine, Morning desk polish).

Install dir assumed: `/etc/personaios`. MagicDNS: `debi9.tail8175e6.ts.net` (adjust if yours differs).

---

## 1) Pull PersonAI

```bash
ssh ralph@debi9
cd /etc/personaios
git fetch origin
git status
git reset --hard origin/main   # deploy known-good tip; stash first if you have local edits
```

---

## 2) Rebuild API + web (Tailscale HTTPS)

```bash
cd /etc/personaios
HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
# optional cold rebuild:
# NO_CACHE=1 HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
```

This rebuilds compose (`api` + `web`), bakes public URLs, and configures Tailscale Serve:

| Role | URL |
|------|-----|
| Web / PWA | `https://debi9.tail8175e6.ts.net` → `:3000` |
| API | `https://debi9.tail8175e6.ts.net:8443` → `:4000` |

If containers are already healthy but Serve says **No serve config**:

```bash
HTTPS=1 ./scripts/vps-tailscale.sh --serve-only debi9.tail8175e6.ts.net
```

Prerequisite: Tailscale admin → DNS → **Enable HTTPS certificates**.

---

## 3) Soul News sidecar (port 8787)

On the VPS (sibling of PersonAI, not inside the personai compose project):

```bash
# first time
cd /opt   # or ~/src — pick a stable parent
git clone <your-soul-news-repo-url> soul-news
cd soul-news
cp .env.example .env
# edit LAT/LON/TZ if needed (defaults Cham/Zug)
docker compose up -d --build
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/v1/feed | head

# later updates
cd /opt/soul-news   # your path
git pull
docker compose up -d --build
```

Point PersonAI at the sidecar in `/etc/personaios/.env`:

```bash
# Docker API on Linux usually cannot use host.docker.internal unless configured.
# Prefer host gateway IP or a user-defined network. Common patterns:
SOUL_NEWS_URL=http://172.17.0.1:8787
# or, if you added host-gateway:
# SOUL_NEWS_URL=http://host.docker.internal:8787
```

Then recreate API so it picks up the env (full script is fine):

```bash
cd /etc/personaios
HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
# or: docker compose up -d --force-recreate api
```

Home widget **Soul News** calls PersonAI `GET /integrations/soul-news/feed` (graceful empty if sidecar down).

---

## 4) First-run / enable after deploy

On phone or desktop (`https://debi9.tail8175e6.ts.net`):

1. Unlock profile.
2. **Settings → API Server** = `https://debi9.tail8175e6.ts.net:8443` → **Save & test**.
3. **Home layout** — ensure widgets you want are on (Morning brief, Heads-up, Confirms, Fristen, Soul News, Archive queue, Drive). Reset layout if an old cached layout hides new widgets.
4. **Google Drive** linked → **Refresh archive context** (and Drive knowledge / taxonomy health as needed).
5. **About you / Personality vault** — open once; seed `USER.md` / prefs (hotel budget, Cham/Zug, Invoice language).
6. Optional: **Theme & lock** passkey; **Sealed suitcase** smoke export; **Drive folder combine** only with dry-run first (no silent deletes).

---

## 5) Verify checklist

```bash
# on VPS
curl -sS http://127.0.0.1:4000/health
curl -sS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3000/
curl -sS http://127.0.0.1:8787/health
sudo tailscale serve status
curl -sS https://debi9.tail8175e6.ts.net:8443/health
curl -sS -o /dev/null -w 'https-web %{http_code}\n' https://debi9.tail8175e6.ts.net/
./scripts/vps-verify.sh debi9.tail8175e6.ts.net   # if present
```

In the app:

- [ ] Unlock works; Settings loads (not stuck on encrypted Settings).
- [ ] Confirm a scan → archive name uses **Invoice** (not `BILL`); Drive pulse after confirm.
- [ ] Team citations / Heads-up / Pocket huddle reachable.
- [ ] Soul News widget shows cards or an honest empty/error (not a crash).
- [ ] Personality vault edits inject into Staff/triage.
- [ ] Folder combine: dry-run shows conflicts; apply never silent-deletes.

---

## Notes

- Do **not** mix `https://` web with `http://…:4000` API (mixed content). Temporary Drive-only workaround: both HTTP (`:3000` / `:4000`) — see [USER-GUIDE.md](./USER-GUIDE.md) § ralph@debi9.
- OAuth redirect (exact): `https://debi9.tail8175e6.ts.net:8443/archive/drive/oauth/callback`
