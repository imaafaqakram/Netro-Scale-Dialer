# Netro Scale - Setup Guide

Browser-based calling app built with Next.js 16, SignalWire (SIP over WebSocket), and Supabase.

---

## Prerequisites

- **Node.js** v18+
- **ngrok** ([ngrok.com](https://ngrok.com)) — for local development
- **SignalWire account** ([signalwire.com](https://signalwire.com))
- **Supabase project** ([supabase.com](https://supabase.com))

---

## Step 1: SignalWire Setup

### 1.1 Get Credentials

From your [SignalWire Dashboard](https://signalwire.com) (**Settings → API**):

| Credential | Where to find | Format |
|---|---|---|
| Space name | The subdomain in your dashboard URL — `yourspace` in `yourspace.signalwire.com` | `yourspace.signalwire.com` |
| Project ID | Settings → API | UUID |
| API Token | Settings → API → Create new token | `PTxxxxxxxx` |

### 1.2 Buy a Phone Number

1. Go to **Phone Numbers → Buy a Number**
2. Select one with **Voice** capability
3. Note the number (e.g., `+19414315039`)

### 1.3 Set the Phone Number's Voice URL

1. Go to **Phone Numbers → Your Number**
2. Set **Accepts incoming calls as**: Voice
3. **When a call comes in**: `https://YOUR-DEPLOYMENT-URL/api/signalwire/webhook`, Method **POST**
4. Save

### 1.4 Browser softphone (SIP) credentials

Unlike Twilio's short-lived JWT model, this app provisions a dedicated SIP username/password for each user automatically on first login (see `src/lib/signalwire/sipCredentials.ts`) — nothing to configure by hand here. The SIP endpoint's `call_request_url` is set to the same `/api/signalwire/webhook` URL, so it needs your deployment's public URL to be reachable — set `NEXT_PUBLIC_APP_URL` (Step 4) before users first log in.

> **Note:** Both the phone number's Voice URL and each user's SIP endpoint point at the same route: `/api/signalwire/webhook` — it tells inbound PSTN calls and outbound browser-originated calls apart by whether `From` looks like a SIP URI.

> **Get `SIGNALWIRE_SIP_DOMAIN` right or nothing will register.** It is not just `yourspace.sip.signalwire.com` — real space domains carry a project-specific suffix (e.g. `yourspace-eb135bd8a9a9.sip.signalwire.com`). A wrong-but-plausible guess still connects and issues a real digest challenge, then rejects every correctly-computed response — indistinguishable from a bad password without protocol-level debugging. Get the exact value from Dashboard -> SIP Endpoints, or from any other SIP client already registered successfully against this space (a FreeSWITCH trunk's registrar URI, etc).

---

## Step 2: Supabase Setup

### 2.1 Create Project

Create a project at [supabase.com](https://supabase.com) and note:
- **Project URL** (Settings → API)
- **Anon Key** (Settings → API → Project API Keys)
- **Service Role Key** (Settings → API → Project API Keys)

### 2.2 Run Database Migration

Go to **SQL Editor** and run these files in order — each is idempotent (safe to
re-run):

1. `supabase-migration-000-base-schema.sql` — **only on a brand-new project
   that doesn't already have a `user_phone_numbers` table.** If you're on the
   original project where it already exists, skip this one or it'll no-op
   harmlessly (`CREATE TABLE IF NOT EXISTS`) — but on a fresh project, every
   file below assumes this table already exists and will fail with
   `relation "user_phone_numbers" does not exist` if you skip it.
2. `supabase-migration.sql`
3. `supabase-migration-002-fixes.sql`
4. `supabase-migration-003-call-history.sql`
5. `supabase-migration-004-multi-tenant.sql`

This creates:
- `user_phone_numbers` table (with voice feature columns)
- `call_recordings` table (for recordings & voicemails)
- `call_history` table (permanent server-side call log)
- `organizations` / `organization_members` / `super_admins` tables (multi-tenant
  roles — see 2.5 below)
- RLS policies for security, scoped per-organization

> **If you already ran `supabase-migration.sql` before today:** you must also run
> `supabase-migration-002-fixes.sql` — it fixes a schema bug where every normal
> call recording (not voicemail) silently failed to save because of a mismatched
> CHECK constraint. Without it, call recording will look "enabled" in Settings but
> nothing will ever show up in Recordings.

### 2.3 Create Users

Go to **Authentication → Users → Add User** to create email/password accounts —
or, once 2.5 below is done, invite them from the app's **Admin** page instead.

### 2.4 Assign Phone Numbers

Once you have at least one org_admin (see 2.5), assign numbers from the app's
**Admin** page instead of by hand. To do it manually anyway (e.g. before any
admin exists), insert rows in **Table Editor → user_phone_numbers**:

| Column | Example |
|---|---|
| `user_id` | User's UUID from Auth |
| `org_id` | The organization's UUID from the `organizations` table |
| `phone_number` | `+13072075599` |
| `friendly_name` | `Main Line` |
| `is_default` | `true` |

### 2.5 Bootstrap Multi-Tenant Roles

`supabase-migration-004-multi-tenant.sql` adds organizations, per-org roles
(`org_admin` / `agent`), and a platform-wide `super_admin` role — see the
comment block at the top of that file for the full model. It automatically
migrates any users that already existed before you ran it into one "Default
Organization" as `org_admin`, so nobody who could already manage their own
numbers loses access.

There's one step it **cannot** do for you: granting the very first
`super_admin`. Nothing in the app can grant that role to itself — it has to be
inserted directly. In **SQL Editor**, run once (with your own user's UUID from
**Authentication → Users**):

```sql
insert into super_admins (user_id) values ('YOUR-USER-UUID-HERE');
```

After that, log in and you'll see an **Admin** link (if you're an `org_admin`
of some organization) and a **Super Admin** link (platform-wide) in the
sidebar. From Super Admin you can create new organizations (each with its own
first `org_admin`, invited by email); from Admin, an `org_admin` invites
`agent`s into their own organization and assigns them phone numbers.

**Known limitation:** an organization's `suspended` flag (toggle in Super
Admin) is currently a record-keeping flag only — it does not yet block that
organization's users from logging in or making calls. Enforcing it is a
follow-up, not yet wired into `middleware.ts` or the SignalWire webhooks.

---

## Step 3: Google Sheets CRM Setup (Optional)

Every completed call and voicemail gets transcribed and written as a row in a Google
Sheet you control — one row per client phone number, updated on each new call. This
requires a Google Cloud **service account**, not your personal Google login.

### 3.1 Create the service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a
   project (or pick an existing one).
2. **APIs & Services → Library** → search "Google Sheets API" → **Enable**.
3. **IAM & Admin → Service Accounts → Create Service Account**. Name it anything
   (e.g. `netro-scale-sheets`). No project roles are needed — it only needs access to
   the specific sheet you share with it in step 3.3.
4. Open the new service account → **Keys → Add Key → Create new key → JSON**. This
   downloads a `.json` file — treat it like a password, it grants write access to
   anything shared with it.

### 3.2 Set the credential

Open the downloaded JSON file and copy its **entire contents** into the
`GOOGLE_SERVICE_ACCOUNT_KEY` environment variable (see Step 4 below) — paste the
whole JSON object as one value. This must be a server-side env var only. Never paste
it into the app's Settings page or any other browser-facing field — unlike the AI
provider API keys in Settings, this credential can access anything shared with it,
not just spend a balance, so it does not belong in a database or browser-editable
setting.

### 3.3 Create and share the sheet

1. Create a new Google Sheet (or use an existing one) — any name, any tab name. Leave
   it empty; the app creates its own header row on the first write.
2. Click **Share**, and share it with the service account's email address (the
   `client_email` field in the JSON key file — looks like
   `netro-scale-sheets@your-project.iam.gserviceaccount.com`) with **Editor** access.
3. Copy the **Sheet ID** from the sheet's URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
4. Paste that ID into **Settings → AI Voice Agent → Google Sheet ID** in the app (each
   user/number can point at their own sheet).

### 3.4 Call transcription

Set at least one of these server-side env vars, or CRM sync will run but every row's
"Last Query"/"Last Transcript" columns will stay blank:

- `DEEPGRAM_API_KEY` — get one at [deepgram.com](https://deepgram.com) (real free-trial
  credit). Can also be set per-user in Settings instead of/in addition to the env var.
- `WHISPER_ENDPOINT_URL` — base URL of a self-hosted, OpenAI-API-compatible Whisper
  server (e.g. `faster-whisper-server`, `LocalAI`), used as a fallback if Deepgram is
  unset or a request to it fails. Fully free/open-source, but needs its own always-on
  server — it cannot run inside this app's Vercel serverless functions.

If both are unset, calls/voicemails still get recorded and logged to the sheet — just
without a transcript or AI-generated summary.

---

## Step 4: Configure Environment

Copy `.env.example` to `.env.local` and fill in your values:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# SignalWire
SIGNALWIRE_SPACE=yourspace.signalwire.com
SIGNALWIRE_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
SIGNALWIRE_API_TOKEN=PTxxxxxxxx
SIGNALWIRE_DEFAULT_NUMBER=+1XXXXXXXXXX
SIGNALWIRE_SIP_DOMAIN=yourspace-xxxxxxxxxxxx.sip.signalwire.com

# Required so the server can build absolute webhook URLs (SIP endpoint
# call_request_url, phone number Voice URL callbacks) — your deployment's own
# public URL, e.g. https://netro-dialer.vercel.app
NEXT_PUBLIC_APP_URL=https://your-deployment-url

# Google Sheets CRM (optional — see Step 3)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","client_email":"...","private_key":"...", ...}

# Call transcription (optional — see Step 3.4)
DEEPGRAM_API_KEY=your-deepgram-key
WHISPER_ENDPOINT_URL=https://your-whisper-server.example.com
```

---

## Step 5: Run

This app is deployed on Vercel, which builds and serves it on a stable public
HTTPS URL automatically on every push to `main` — no ngrok/tunnel needed the
way local development required. Set `NEXT_PUBLIC_APP_URL` (Step 4) to that
deployment URL, push, then open the app, log in, and verify **"Ready"** status.

To run locally instead, start ngrok (`ngrok http 3000`), set
`NEXT_PUBLIC_APP_URL` to the ngrok HTTPS URL, update the phone number's Voice
URL to match, then `npm install && npm run dev`.

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── signalwire/
│   │   │   ├── token/        # JWT token generation
│   │   │   ├── webhook/      # Incoming & outgoing call handling
│   │   │   └── voicemail/    # Voicemail recording & playback
│   │   └── user/
│   │       ├── numbers/      # Phone number management
│   │       └── voice-settings/ # Recording & voicemail toggles
│   ├── calls/                # Main dialer page
│   ├── login/                # Auth page
│   └── settings/             # User settings
├── components/               # UI components
├── hooks/                    # SignalWire device, call state
├── lib/                      # Config, API client, Supabase
└── middleware.ts             # Auth protection
```

### Call Flow

**Outgoing:** Browser → JsSIP → SignalWire Cloud → `/api/signalwire/webhook` → LaML → Connects call

**Incoming:** Phone call → SignalWire → `/api/signalwire/webhook` → Looks up user by number → Routes to browser client

---

## Features

| Feature | Description |
|---|---|
| Multi-user auth | Supabase email/password with admin-assigned numbers |
| Incoming calls | Routed to correct user based on dialed number |
| Outgoing calls | Uses user's default caller ID |
| Call recording | Toggle per-number in Settings |
| Voicemail | Plays greeting, records message when unanswered |
| Answer on bridge | Call only answered when user picks up |
| DTMF tones | Send digits during active calls |
| Call history | Local call log with filtering |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Status never becomes "Ready" | Check SignalWire env vars in `.env.local` |
| Calls redirect to /login | Middleware bypass not working — check `middleware.ts` |
| "Document parse failure" errors | Check for unescaped `&` in TwiML XML |
| Incoming calls don't ring | Verify phone number Voice URL points to `/api/signalwire/webhook` |
| Voicemail not saving | Run `supabase-migration.sql` and check `SUPABASE_SERVICE_ROLE_KEY` |
| ngrok URL changed | Update TwiML App + Phone Number webhook URLs |

---

## Deployment (Vercel)

1. Connect repo to Vercel
2. Add all env vars from `.env.example`
3. Deploy — webhook URLs will be `https://your-app.vercel.app/api/signalwire/webhook`
4. Update TwiML App and Phone Number webhooks to the Vercel URL
