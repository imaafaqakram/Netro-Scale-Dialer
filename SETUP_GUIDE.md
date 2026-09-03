# Netro Scale - Setup Guide

Browser-based calling app built with Next.js 16, Twilio Voice SDK, and Supabase.

---

## Prerequisites

- **Node.js** v18+
- **ngrok** ([ngrok.com](https://ngrok.com)) — for local development
- **Twilio account** ([twilio.com](https://www.twilio.com))
- **Supabase project** ([supabase.com](https://supabase.com))

---

## Step 1: Twilio Setup

### 1.1 Get Credentials

From the [Twilio Console](https://console.twilio.com):

| Credential | Where to find | Format |
|---|---|---|
| Account SID | Dashboard | `ACxxxxxxxx` |
| API Key | Account → API Keys → Create Standard | `SKxxxxxxxx` |
| API Secret | Shown once when creating API Key | Save immediately! |

### 1.2 Buy a Phone Number

1. Go to **Phone Numbers → Buy a Number**
2. Select one with **Voice** capability
3. Note the number (e.g., `+13072075599`)

### 1.3 Create a TwiML App

1. Go to **Voice → TwiML Apps → Create**
2. Name: `Netro Scale`
3. **Voice Request URL**: `https://YOUR-NGROK-URL/api/twilio/webhook`
4. Method: **POST**
5. Save and copy the **SID** (starts with `AP`)

### 1.4 Configure Phone Number Webhook

1. Go to **Phone Numbers → Active Numbers → Your Number**
2. Under **Voice Configuration**:
   - **A call comes in**: Webhook
   - **URL**: `https://YOUR-NGROK-URL/api/twilio/webhook`
   - **Method**: POST
3. Save

> **Note:** Both the TwiML App and Phone Number webhook point to the same URL: `/api/twilio/webhook`

---

## Step 2: Supabase Setup

### 2.1 Create Project

Create a project at [supabase.com](https://supabase.com) and note:
- **Project URL** (Settings → API)
- **Anon Key** (Settings → API → Project API Keys)
- **Service Role Key** (Settings → API → Project API Keys)

### 2.2 Run Database Migration

Go to **SQL Editor** and run the contents of `supabase-migration.sql`, then
`supabase-migration-002-fixes.sql`, then `supabase-migration-003-call-history.sql`,
in that order. Each file is idempotent (safe to re-run).

This creates:
- `user_phone_numbers` table (with voice feature columns)
- `call_recordings` table (for recordings & voicemails)
- `call_history` table (permanent server-side call log)
- RLS policies for security

> **If you already ran `supabase-migration.sql` before today:** you must also run
> `supabase-migration-002-fixes.sql` — it fixes a schema bug where every normal
> call recording (not voicemail) silently failed to save because of a mismatched
> CHECK constraint. Without it, call recording will look "enabled" in Settings but
> nothing will ever show up in Recordings.

### 2.3 Create Users

Go to **Authentication → Users → Add User** to create email/password accounts.

### 2.4 Assign Phone Numbers

In **Table Editor → user_phone_numbers**, insert rows:

| Column | Example |
|---|---|
| `user_id` | User's UUID from Auth |
| `phone_number` | `+13072075599` |
| `friendly_name` | `Main Line` |
| `is_default` | `true` |

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

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxx
TWILIO_API_SECRET=your-secret
TWILIO_TWIML_APP_SID=APxxxxxxxx
TWILIO_DEFAULT_NUMBER=+1XXXXXXXXXX

# Google Sheets CRM (optional — see Step 3)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","client_email":"...","private_key":"...", ...}

# Call transcription (optional — see Step 3.4)
DEEPGRAM_API_KEY=your-deepgram-key
WHISPER_ENDPOINT_URL=https://your-whisper-server.example.com
```

---

## Step 5: Run Locally

### Terminal 1: Start ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://xxxx.ngrok-free.dev`) and update:
- TwiML App Voice Request URL
- Phone Number Voice Webhook URL

### Terminal 2: Start the app

```bash
npm install
npm run dev
```

Open http://localhost:3000, log in, and verify **"Ready"** status.

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── twilio/
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
├── hooks/                    # Twilio device, call state
├── lib/                      # Config, API client, Supabase
└── middleware.ts             # Auth protection
```

### Call Flow

**Outgoing:** Browser → Twilio SDK → Twilio Cloud → `/api/twilio/webhook` → TwiML → Connects call

**Incoming:** Phone call → Twilio → `/api/twilio/webhook` → Looks up user by number → Routes to browser client

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
| Status never becomes "Ready" | Check Twilio env vars in `.env.local` |
| Calls redirect to /login | Middleware bypass not working — check `middleware.ts` |
| "Document parse failure" errors | Check for unescaped `&` in TwiML XML |
| Incoming calls don't ring | Verify phone number webhook points to `/api/twilio/webhook` |
| Voicemail not saving | Run `supabase-migration.sql` and check `SUPABASE_SERVICE_ROLE_KEY` |
| ngrok URL changed | Update TwiML App + Phone Number webhook URLs |

---

## Deployment (Vercel)

1. Connect repo to Vercel
2. Add all env vars from `.env.example`
3. Deploy — webhook URLs will be `https://your-app.vercel.app/api/twilio/webhook`
4. Update TwiML App and Phone Number webhooks to the Vercel URL
