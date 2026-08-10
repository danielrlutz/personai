# PersonAI — getting started

This guide is for **you** as a new user (desktop app or phone browser / PWA).  
It uses the same labels you see on screen.

---

## 1. First open — unlock or set a password

1. Open PersonAI:
   - **Desktop:** launch the PersonAI app.
   - **Phone / PWA:** open the **HTTPS** address your host gave you (Tailscale Serve, e.g. `https://….ts.net` — see the example box). Plain `http://…:3000` works for browsing but Chrome will **not** offer **Install app**.
2. You land on the account screen: **Sign in — your data is password-protected**.
3. Pick your account, or tap **Use another account** to create one.

| Situation | What you see | What to do |
|-----------|--------------|------------|
| Existing account with a password | **Password protected** → **Enter password for …** | Type **Password** → **Unlock** |
| Existing account, never set a password | **Set password to continue** → **Set a password for …** | **Choose a password (min 8)** + **Confirm password** → **Set password & continue** |
| Brand-new account | **Create a protected account** | **Profile name** + password (min 8) → **Create & unlock** |

Your password unlocks this profile and decrypts its private database. You need it on every device that opens this account.

After unlock you arrive at **Home** (**Morning desk**). Optional guided setup lives at **First-launch setup** (`/setup/` — also **Setup wizard** in the command palette).

---

## 2. Guided setup and Settings (do this once)

You can use **First-launch setup** (steps: **Identity** → **Local AI** → **Google** → **Archive** → **Alerts** → **Finish setup**), then finish the rest under **Settings**.  
Or stay in **Settings** and follow the order below.

Open **Settings** (sidebar → **Account** → **Settings**).

### Step A — Identity and how you use PersonAI

In **Your profile**:

1. Under **I use this for**, choose one:
   - **Personal** — Life, habits, and health first. Finance stays available without company defaults.
   - **Business** — Finance and legal up front. Life stays available when you need it.
   - **Both** — Personal-first Home layout, with business modules ready — no company assumed.
2. Fill **Display name**, and if you chose Business/Both optionally **Company**.
3. Set **Locale** (e.g. `de-CH`), **Language**, **Timezone** (e.g. `Europe/Zurich`), **Brief hour** (e.g. `07:00`).
4. Optional: **Short standing notes**.
5. Tap **Save profile**.

New profiles default to **Personal** — no MWST or business legal tasks are auto-created.

### Step B — Local AI (Ollama)

1. Scroll to **Ollama status**. You want badge **Reachable** (not **Offline**).
2. If needed, set the host URL (often `http://127.0.0.1:11434` on the same machine as the API) and tap **Use this Ollama host**.
3. Prefer storing the lasting host + models in **Product vault** (next step), not only the quick status field. Tap **Refresh status** anytime.

In **First-launch setup** → **Local AI**, the same idea is: PersonAI prefers local Ollama; if unreachable you’ll see **Offline / unreachable**.

### Step C — Product vault (what to paste)

Open **Product vault**. Day-to-day product config lives here — not in server files you edit by hand.

Paste / set:

| Field | What it is |
|-------|------------|
| **Ollama host** | Where the API reaches Ollama |
| Model fields (**Vision / OCR**, **Reasoning (Staff/CFO/Legal/Medical)**, **Architect**, **Forge coder**, **QA (deepseek-r1)**, **Coaching**, **Stylist text**) | Optional overrides; leave blank to use defaults |
| **Public web URL** | The address you open in the browser (e.g. `http://host:3000`) |
| **Public API URL** | The API address (e.g. `http://host:4000`) — used to build the Drive redirect |
| Under **Google OAuth (paste once)** → **Client ID** | From Google Cloud (next section) |
| **Client secret** | Paste once; after save it shows as configured / masked |
| **Redirect URI** | Must be `{your Public API URL}/archive/drive/oauth/callback` |
| **Premium / cloud (optional)** | Only if you use premium cloud inference |

Tap **Save product vault**.  
Secrets are write-once and masked: *“Saved to encrypted host vault. Secrets are never shown plain again.”*

On the phone, if the app cannot reach the API, use **API Server** first: paste the API URL → **Save & test API URL** (or **Use this host's API** when suggested). No trailing slash.

### Step D — Google Cloud Console (create OAuth + Drive)

Do this in a normal browser while logged into the Google account that will own the archive.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**
   - Choose **External** (or Internal if you only use a Google Workspace org).
   - App name e.g. `PersonAI`, your email as support/developer contact.
   - For personal use, add your Google account under **Test users** while the app is in Testing.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized redirect URIs** — add **exactly**:

     `{API_URL}/archive/drive/oauth/callback`

     where `{API_URL}` is the same value as **Public API URL** in **Product vault** (no trailing slash on the API URL).

5. Copy **Client ID** and **Client secret** into **Product vault** → **Google OAuth (paste once)** → **Save product vault**.

PersonAI will also show the redirect under **Google Drive archive** as **OAuth redirect must match:** … when OAuth is ready.

### Step E — Link Google Drive

In **Settings** → **Google Drive archive**:

1. Status should move from **Not linked** toward ready to connect once the vault has Client ID + secret.
2. Tap **Link Google Drive** (opens Google; approve Drive access).
3. You return to Settings; badge should become **Linked** / **Your Google account**.
4. Optional: paste a **Drive root folder ID** → **Save root folder** (or leave empty — PersonAI reuses an existing root such as **Archived Files** / `PersonAI_Archive` when present, otherwise creates `PersonAI_Archive`).
5. Tap **Verify connection** if you want a quick check.
6. Tap **Refresh archive context** so specialists can see filed documents (**Archive context ready** when done).

You can re-run **Refresh archive context** anytime after adding files outside PersonAI. **Unlink** removes the OAuth link for this profile only.

Until Drive is linked, chat still works — without archive context. Local archive still works from **Archive**.

### Step F — Optional archive taxonomy

Folders PersonAI uses (local + optional Drive):

| # | Label |
|---|--------|
| 01 | Official |
| 02 | Housing |
| 03 | Insurance |
| 04 | Financial |
| 05 | Employment |
| 06 | Health |
| 07 | Education |
| 08 | Legal |
| 09 | Misc |
| 10 | Vehicles |

Also listed in **First-launch setup** → **Archive**. Naming pattern after confirm: `{date}_{DocType}_{Entity}{ext}` where `{ext}` matches the stored file (e.g. `2026-08-09_BILL_Swisscom.pdf` or `.png` for a single-page scan).

**Drive folder matching:** PersonAI does **not** invent a second taxonomy next to yours. Under your archive root (`Archived Files`, `PersonAI_Archive`, or similar), it matches category folders by name — numbering style (`01_`, `1.`, `01 -`, …) and EN/DE/FR labels (e.g. `1. Official Documents` ↔ Official, `Versicherung` ↔ Insurance). If regex is unsure, a small local Ollama model may pick once; the mapping is cached per profile so uploads reuse it. New `01_Label` folders are created only when nothing matches. PersonAI **never deletes** Drive folders — if you already have both `01_Official` and `1. Official Documents`, merge or remove the empty duplicate yourself in Google Drive; the app will keep using the richer/legacy match.

**Taxonomy health (Settings → Google Drive archive):** Tap **Scan folder map** to list duplicate candidates under your archive root, see the suggested winner (more files / legacy name), and **Prefer forever** to cache that folder for uploads. This only updates PersonAI's mapping — it does not delete or merge Drive folders.

**Confirm → Drive is durable:** Approving a filing writes the local archive immediately (the confirm barrier). Google Drive upload continues on the server as a background job even if you close the tab or navigate away. After Confirm, a **Drive upload** strip on Home / Needs your confirmation polls job status (Queued → Done / Failed), links to **Activity**, and lets you **Retry** a failed upload without re-filing locally.

### Step G — Optional comfort settings

- **Theme & lock** — theme **system** / **dark** / **light**; optional **Set 4–8 digit PIN** → **Enable PIN**, and on HTTPS (Tailscale Serve / PWA) **Register passkey** for Face ID / fingerprint resume after you unlock with your profile password once (locks UI on tab hide / idle; database still sealed by password; passkeys soft-hide over plain HTTP).
- **Password & encryption** — **Change password** anytime.
- **Memory facts** — short facts specialists should remember → **Add**.
- **First-launch setup** → **Alerts** → **Allow notifications** for Fristen and pending confirms.
- Profile menu: **Switch profile** / **Sign out** (both return to the account picker and seal the session).

---

## 3. Daily use

### Home — triage dump

**Home** is titled **Morning desk**.

1. Under **Drop it here**, paste text, or use **PDF / file** / **Camera**.
2. Tap **Triage with Staff**.
3. Under **Staff proposes**, you’ll see who should handle it.
4. Optionally change **Override specialist**, then:
   - **Open chat** — talk to that specialist on **Team**, or
   - **Go to …** — jump to the suggested area (archive, finance, legal, medical, …).

Pending work appears under **Needs your confirmation**. **Fristen** lists upcoming deadlines. **Brief** is the morning snapshot. Shortcuts: **Activity**, **Team**.

### Confirm gates (edit naming before filing)

When OCR or a specialist wants to write to archive / ledger / export, you get **Needs your confirmation**.

For archive items you can:

- **View file** — open an in-app preview (image lightbox or PDF) before deciding
- Edit **Date**, **DocType**, **Entity**, **Category**
- Preview line `→ {date}_{DocType}_{Entity}{ext}` (extension matches the real file; header and preview stay in sync)
- **Save naming (still pending)** — updates the draft without filing
- **Confirm** — writes (local archive and Drive if linked; same filename + MIME)
- **Decline** — leaves external systems unchanged; local staging kept

### Activity

Open **Activity** (nav or Home). Audit trail for confirms, archive writes, triage, and exports. Tap **Refresh** to reload.

### Fristen

On **Home**, the **Fristen** strip shows open deadlines.

- **Done** — mark a legal task finished.
- **All deadlines** — opens **Legal**.
- Document-linked items can jump to **Archive**.

### Team specialists

Open **Team**. Important changes still ask for confirmation first.

| Specialist | Role (short) |
|------------|----------------|
| Staff | Triage, archive, morning brief |
| Architect | Design and specs |
| Forge | Implementation |
| QA Auditor | Pass/fail before ship |
| CFO | Invoices and ledger |
| Legal Aide | Contracts, court papers, Fristen |
| Medical Integrator | Records, symptoms, care timelines |
| Bio Mechanic | Body and recovery |
| Mystic | Reflective coaching |
| Stylist | Aesthetic coaching |
| Wingman | Social coaching |
| Career Strategist | CV and career PDF |

### Archive

**Archive** — drop files for OCR. Confirm naming under **Needs your confirmation**. Local archive works without Drive; use **Drive settings** when you want cloud copies.

### Finance

**Finance** — budgets, Swiss QR bills, cash flow. Saving payments needs confirmation. **Ask finance** opens **Team** with **CFO**. **Transactions** lists ledger history.

---

## 4. Security habits

- Prefer **Sign out** (or **Switch profile**) when you leave a shared or unlocked device — that seals the encrypted profile database until the next **Unlock**.
- Use a strong profile password (min 8). Change it under **Password & encryption**.
- Optional **Enable PIN** and (on HTTPS / PWA) **Register passkey** for quick UI lock on idle / resume — they do **not** replace the password or unwrap the sealed DB.
- Never share **Client secret**, **Premium API key**, passwords, or session details. After paste into **Product vault**, secrets stay masked.
- Desktop and phone against **different** installs do not sync automatically. Same VPS URL on phone + laptop **does** share that profile’s data.

---

## 5. What needs a one-time host vs what is 100% in Settings

### One-time on the host / VPS (someone with the machine)

Typically only once when PersonAI is installed:

- App / Docker stack running
- Network reachability: web (usually **port 3000**), API (usually **port 4000**), and Ollama on the host if used (often **11434**)
- Tailscale (or similar) if you open from a phone off the LAN
- Optional: host already has Ollama with models pulled

You do **not** need SSH for normal Drive linking or day-to-day config once the app is up.

### 100% in Settings (you, in the UI)

- **API Server** URL override (phones)
- **Product vault** (Ollama host, models, public URLs, Google Client ID/secret, redirect URI, premium key)
- **Ollama status** / **Use this Ollama host**
- **Your profile** / usage mode / memory facts
- **Google Drive archive** → **Link Google Drive**, root folder, **Refresh archive context**
- **Theme & lock** / PIN
- **Password & encryption**
- Daily work: Home triage, confirms, Activity, Fristen, Team, Archive, Finance

---

## Example: Tailscale MagicDNS (`debi9`) — HTTPS for Install app

Use your own hostname if different. Full `*.ts.net` names work more reliably on Android than short names.

Chrome only shows **Install app** on a secure origin (`https://…`, or localhost). Tailscale WireGuard does **not** count as HTTPS for that check. “Add to Home screen” on HTTP is a shortcut, not a PWA.

On the VPS (once HTTPS is enabled in the Tailscale admin DNS page):

```bash
cd /etc/personaios
HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
```

If `tailscale serve status` shows **No serve config** (HTTPS `:8443` fails but `http://127.0.0.1:4000/health` works):

```bash
# A) Quick — browse + Drive today (not Install app)
# Phone: http://debi9.tail8175e6.ts.net:3000
# Settings → API Server → http://debi9.tail8175e6.ts.net:4000 → Save & test

# B) Full — restore Serve for PWA
HTTPS=1 ./scripts/vps-tailscale.sh --serve-only debi9.tail8175e6.ts.net
# or: sudo tailscale serve reset
#     sudo tailscale serve --bg --yes --https=443 3000
#     sudo tailscale serve --bg --yes --https=8443 4000
```

Then on the phone:

```text
Web / Install app:  https://debi9.tail8175e6.ts.net
API:                https://debi9.tail8175e6.ts.net:8443
API health:         https://debi9.tail8175e6.ts.net:8443/health

Product vault → Public web URL:  https://debi9.tail8175e6.ts.net
Product vault → Public API URL:  https://debi9.tail8175e6.ts.net:8443

Google OAuth authorized redirect URI (exact):
https://debi9.tail8175e6.ts.net:8443/archive/drive/oauth/callback
```

1. Open **`https://debi9.tail8175e6.ts.net`** (no `:3000`).
2. `/profiles/` → **Unlock**.
3. If needed: **Settings → API Server** → `https://debi9.tail8175e6.ts.net:8443` → **Save & test**.
4. Chrome menu → **Install app**.

Browse-only HTTP (not installable): `http://debi9.tail8175e6.ts.net:3000` / API `:4000`.

### ralph@debi9 — Serve / Drive recovery

If Settings shows **Loading encrypted Settings…**, Active API `https://…:8443`, and `/ceo-profile` / `/memory-facts` fail, Tailscale Serve for the API is usually broken. Product vault and **Link Google Drive** cannot load until the API answers.

**Immediate workaround (Drive setup only — not PWA Install app):**

```text
Phone browser → http://debi9.tail8175e6.ts.net:3000
Settings → API Server → http://debi9.tail8175e6.ts.net:4000 → Save & test
Unlock → Product vault → OAuth → Link Google Drive
```

Do **not** stay on `https://…` and point the API at `http://…:4000` — browsers block that as mixed content.

**VPS fix (ralph@debi9):**

```bash
cd /etc/personaios
git fetch && git reset --hard origin/main

# 1) Local stack healthy?
curl -sS http://127.0.0.1:4000/health
curl -sS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3000/

# 2) Serve status + MagicDNS probes
sudo tailscale serve status
curl -sS https://debi9.tail8175e6.ts.net:8443/health
curl -sS -o /dev/null -w 'https-web %{http_code}\n' https://debi9.tail8175e6.ts.net/
curl -sS http://debi9.tail8175e6.ts.net:4000/health

# 3) Recreate Serve only (no docker rebuild) — when status says "No serve config"
HTTPS=1 ./scripts/vps-tailscale.sh --serve-only debi9.tail8175e6.ts.net
# manual equivalent:
#   sudo tailscale serve reset
#   sudo tailscale serve --bg --yes --https=443 3000
#   sudo tailscale serve --bg --yes --https=8443 4000
sudo tailscale serve status
curl -sS https://debi9.tail8175e6.ts.net:8443/health

# 4) Or full HTTPS rebuild (bake URLs + Serve + probe)
HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
./scripts/vps-verify.sh debi9.tail8175e6.ts.net
```

**Phone after Serve is healthy:**

1. Open `https://debi9.tail8175e6.ts.net` (clear site data for old HTTP origins if needed).
2. Unlock → Settings API = `https://debi9.tail8175e6.ts.net:8443` → Save & test.
3. Product vault → Public API URL + redirect  
   `https://debi9.tail8175e6.ts.net:8443/archive/drive/oauth/callback` (also in Google Cloud).
4. **Link Google Drive** → Refresh archive context.
5. Optional: Chrome → **Install app**.

---

## Quick checklist

- [ ] Unlock or **Set password & continue**
- [ ] **Your profile** → **I use this for** → **Save profile**
- [ ] **Ollama status** → **Reachable** (host in **Product vault** if needed)
- [ ] Google Cloud: Drive API + consent screen + Web OAuth client + redirect URI
- [ ] **Product vault** → paste Client ID/secret + URLs → **Save product vault**
- [ ] **Link Google Drive** → **Refresh archive context**
- [ ] Optional PIN under **Theme & lock**
- [ ] Daily: **Drop it here** → confirm naming → **Confirm**
