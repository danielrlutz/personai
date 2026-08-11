# Local deploy wave notes (copy to DEPLOY-WAVE.local.md)

**Do not commit `DEPLOY-WAVE.local.md`.** It is gitignored. Keep real hostnames, SSH users, and MagicDNS here only.

```bash
cp docs/DEPLOY-WAVE.local.example.md docs/DEPLOY-WAVE.local.md
# edit DEPLOY-WAVE.local.md with your values
```

## Your values (fill in)

| Field | Example placeholder | Your value |
|-------|---------------------|------------|
| SSH user@host | `deploy@your-host` | |
| SSH port | `22` | |
| SSH key | `~/.ssh/id_ed25519` | |
| MagicDNS FQDN | `your-host.tailXXXX.ts.net` | |
| Install dir | `/etc/personaios` | |

## Quick commands (replace placeholders)

```bash
ssh -p 22 -i ~/.ssh/your-deploy-key deploy@your-host
cd /etc/personaios
git fetch origin
git merge --ff-only origin/main

HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
./scripts/vps-verify.sh your-host.tailXXXX.ts.net
curl -sS https://your-host.tailXXXX.ts.net:8443/health
```

Public repo doc: [DEPLOY-WAVE.md](./DEPLOY-WAVE.md) uses generic placeholders only.
