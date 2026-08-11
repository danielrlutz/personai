# Deploy wave — deploy@your-host (+ Soul News sidecar)

> **Local-only details:** copy [DEPLOY-WAVE.local.example.md](./DEPLOY-WAVE.local.example.md) to `docs/DEPLOY-WAVE.local.md` (gitignored) for your real SSH host and MagicDNS. Also see [DEPLOY.local.md.example](./DEPLOY.local.md.example) for `.env.deploy.local` / `deploy-vps.sh`.


Copy-paste steps after `origin/main` includes the wave merges (Invoice naming, Drive knowledge / Frist kit, specialist agency, Jahresakte, sealed suitcase, Drive folder combine, Morning desk polish).

Install dir assumed: `/etc/personaios`. MagicDNS: `your-host.tailXXXX.ts.net` (adjust if yours differs).

---

## 1) Pull PersonAI

```bash
ssh -p 22 -i ~/.ssh/your-deploy-key deploy@your-host
cd /etc/personaios
git fetch origin
git status
git reset --hard origin/main   # deploy known-good tip; stash first if you have local edits
```

---

## 2) Rebuild API + web (Tailscale HTTPS)

```bash
cd /etc/personaios
HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
# optional cold rebuild:
# NO_CACHE=1 HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
```

This rebuilds compose (`api` + `web`), bakes public URLs, and configures Tailscale Serve:

| Role | URL |
|------|-----|
| Web / PWA | `https://your-host.tailXXXX.ts.net` Ã¢â€ â€™ `:3000` |
| API | `https://your-host.tailXXXX.ts.net:8443` Ã¢â€ â€™ `:4000` |

If containers are already healthy but Serve says **No serve config**:

```bash
HTTPS=1 ./scripts/vps-tailscale.sh --serve-only your-host.tailXXXX.ts.net
```

Prerequisite: Tailscale admin Ã¢â€ â€™ DNS Ã¢â€ â€™ **Enable HTTPS certificates**.

---

## 3) Soul News sidecar (port 8787)

On the VPS (sibling of PersonAI, not inside the personai compose project):

```bash
# first time
cd /opt   # or ~/src Ã¢â‚¬â€ pick a stable parent
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
HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
# or: docker compose up -d --force-recreate api
```

Home widget **Soul News** calls PersonAI `GET /integrations/soul-news/feed` (graceful empty if sidecar down).

---

## 4) First-run / enable after deploy

On phone or desktop (`https://your-host.tailXXXX.ts.net`):

1. Unlock profile.
2. **Settings Ã¢â€ â€™ API Server** = `https://your-host.tailXXXX.ts.net:8443` Ã¢â€ â€™ **Save & test**.
3. **Home layout** Ã¢â‚¬â€ ensure widgets you want are on (Morning brief, Heads-up, Confirms, Fristen, Soul News, Archive queue, Drive). Reset layout if an old cached layout hides new widgets.
4. **Google Drive** linked Ã¢â€ â€™ **Refresh archive context** (and Drive knowledge / taxonomy health as needed).
5. **About you / Personality vault** Ã¢â‚¬â€ open once; seed `USER.md` / prefs (hotel budget, Cham/Zug, Invoice language).
6. Optional: **Theme & lock** passkey; **Sealed suitcase** smoke export; **Drive folder combine** only with dry-run first (no silent deletes).

---

## 5) Verify checklist

```bash
# on VPS
curl -sS http://127.0.0.1:4000/health
curl -sS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3000/
curl -sS http://127.0.0.1:8787/health
sudo tailscale serve status
curl -sS https://your-host.tailXXXX.ts.net:8443/health
curl -sS -o /dev/null -w 'https-web %{http_code}\n' https://your-host.tailXXXX.ts.net/
./scripts/vps-verify.sh your-host.tailXXXX.ts.net   # if present
```

In the app:

- [ ] Unlock works; Settings loads (not stuck on encrypted Settings).
- [ ] Confirm a scan Ã¢â€ â€™ archive name uses **Invoice** (not `BILL`); Drive pulse after confirm.
- [ ] Team citations / Heads-up / Pocket huddle reachable.
- [ ] Soul News widget shows cards or an honest empty/error (not a crash).
- [ ] Personality vault edits inject into Staff/triage.
- [ ] Folder combine: dry-run shows conflicts; apply never silent-deletes.

---

## Notes

- Do **not** mix `https://` web with `http://Ã¢â‚¬Â¦:4000` API (mixed content). Temporary Drive-only workaround: both HTTP (`:3000` / `:4000`) Ã¢â‚¬â€ see [USER-GUIDE.md](./USER-GUIDE.md) Ã‚Â§ deploy@your-host.
- OAuth redirect (exact): `https://your-host.tailXXXX.ts.net:8443/archive/drive/oauth/callback`
