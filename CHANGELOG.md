# Changelog

## 2026-09-13 — Fix call history never saving + SignalWire balance widget

### 🐛 Root cause: AI-call telemetry store didn't survive serverless

- **`call_history` rows were never being written for AI-agent calls.** [`src/lib/ai/callStore.ts`](src/lib/ai/callStore.ts) kept live call state (status, transcript, which user placed the call) in a plain `Map` attached to `global` — a trick that only works for surviving hot-reload in local dev. On Vercel, a single call's lifecycle (`/ai-call/start` → the greeting → one `/ai-call/turn` hit per turn → the final `/ai-call/status`) is several separate HTTP requests that can each land on a different, independent serverless instance with its own empty Map. The terminal status callback routinely saw a call it had never registered, fell back to a placeholder identity, and every `call_history` write for that identity failed silently — recordings were equally affected, since they're gated by the same request path.
- **Fixed by replacing the in-memory Map with a real Supabase-backed store** (new `ai_call_sessions` table — run `supabase-migration-006-ai-call-sessions.sql` in the Supabase SQL Editor). Same function names/shapes as before (`registerCall`, `updateCall`, `getCall`, `getAllActiveCalls`), now `async`.
- **To avoid adding latency to the live conversation**, the per-turn writes in [`src/app/api/signalwire/ai-call/turn/route.ts`](src/app/api/signalwire/ai-call/turn/route.ts) and the greeting write in [`ai-call/route.ts`](src/app/api/signalwire/ai-call/route.ts) now run via Next's `after()` — scheduled to complete in the background *after* the TwiML response is already on its way back to SignalWire, so the caller never waits on a Supabase round-trip mid-conversation. The two writes-per-turn (user turn, AI reply) were also combined into one.
- **`upsertCallHistory`** ([`src/lib/callHistory.ts`](src/lib/callHistory.ts)) now validates `userId` looks like a real UUID before writing, and logs clearly instead of silently swallowing the failure if a caller ever passes the `'user'` placeholder again — this exact failure mode should never take hours to diagnose a second time.
- **Hardened the direct-dial webhook's own user resolution** ([`src/app/api/signalwire/webhook/route.ts`](src/app/api/signalwire/webhook/route.ts)): it was parsing the calling user's identity out of the SIP `From` header assuming a bare `sip:user@domain` form, which breaks if SignalWire wraps it with the endpoint's configured display name (`"Netro Scale" <sip:user@domain>`). The browser now sends its own Supabase user id directly via a new `X-User-Id` SIP header ([`useSignalWireDevice.ts`](src/hooks/useSignalWireDevice.ts)), with the header-parsing kept as a fallback (now handles the wrapped form too).
- `package-lock.json` regenerated — it had gone stale during the Twilio→SignalWire migration and still listed `@twilio/voice-sdk`/`twilio` and the old package name.

### ✨ New: SignalWire account balance in the sidebar

- Admins (org admin or super admin) now see a live SignalWire balance card in the sidebar footer, next to Active Caller ID. New `GET /api/admin/balance` route ([`src/app/api/admin/balance/route.ts`](src/app/api/admin/balance/route.ts)), same admin-only gating as `/api/admin/numbers`. Backed by a new `getAccountBalance()` in [`restClient.ts`](src/lib/signalwire/restClient.ts) (Twilio-compatible `/Balance.json`).

### ✅ Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean production build, no errors, `/api/admin/balance` present in the route list.
- **Not yet confirmed against a live call** — recommend one more AI-agent test call after running the migration, then check Call History shows a completed row and Recordings shows the recording (if enabled).

## 2026-08-17 (2) — Stop caching API keys in the browser

### 🔒 Security fix

- **AI provider API keys (Cerebras/Replicate/etc.) were being cached in `localStorage` in plaintext.** [`src/app/settings/page.tsx`](src/app/settings/page.tsx) mirrored the *entire* AI Settings object — including raw API keys — into `localStorage` under `marvik_ai_settings` as a "load faster next time" shortcut. This served no functional purpose (the page already re-fetches the same data from the server on every load) and left the keys readable in plaintext to any script running on the page or anyone with access to that browser profile, indefinitely. Removed both the read and the write; the Settings page now loads and saves AI settings via the server API only (`/api/user/ai-settings`, which persists to Supabase `user_metadata` server-side).
- **Note:** if this app was already used on this browser before today, an old copy may still be sitting in that browser's localStorage from prior sessions. Clear it manually via DevTools → Application → Local Storage → remove the `marvik_ai_settings` key, or just clear site data for this origin.
- **Twilio/Supabase credentials were not affected** — those already lived only in `.env.local` (server-side, gitignored) and were never sent to the browser.

## 2026-08-17 — Fix AI warm transfer + genericize call script

### 🐛 Bug fixes

- **Warm transfer never rang the softphone.** [`src/app/api/twilio/ai-call/route.ts`](src/app/api/twilio/ai-call/route.ts) built the outbound AI call's callback URL with `agentUserId=<your-user-uuid>` in the query string, but the handler that receives it only checked `params['userId']` (a key nothing ever sent). So `agentUserId` always fell through to the literal string `"user"`, and every downstream transfer tried to dial a Twilio Client named `"user"` — which no browser is ever registered as (your softphone registers under your Supabase user UUID, see [`src/app/api/twilio/token/route.ts:35`](src/app/api/twilio/token/route.ts:35)). Fixed the fallback order to read `agentUserId` first.
- **Opening greeting ignored your saved AI Settings.** [`src/app/api/twilio/ai-call/route.ts`](src/app/api/twilio/ai-call/route.ts) always spoke a hardcoded, non-configurable greeting regardless of what was saved in Settings — only the mid-call `system_prompt` was actually being fetched per-user. The entry handler now looks up the user's saved AI settings the same way the turn handler already did, and uses a new `greeting_message` field if one is saved.
- **Test-call greeting (`*99`) referenced the old hardcoded script name.** Genericized in [`src/app/api/twilio/webhook/route.ts`](src/app/api/twilio/webhook/route.ts).

### ✨ New: caller name shown on transfer

You asked for the dialer to show *who* is being transferred, not just your own business number.

- `AutoDialer.tsx` now sends the lead's name (from your uploaded file) to `/api/twilio/ai-call/start` alongside the number.
- That name is threaded through `start` → the AI entry webhook → every turn of the conversation → the final `<Dial><Client>` transfer verb, embedded as TwiML `<Parameter name="LeadName">` / `<Parameter name="CustomerNumber">` on the `<Client>` noun (Twilio's documented mechanism for custom call data).
- The browser softphone reads these via `call.customParameters` (`useTwilioDevice.ts`) and now shows the **lead's name** — not your own Twilio caller ID — on the incoming-call banner and the active-call popup, with the real customer number shown underneath.
- Files touched: `src/app/api/twilio/ai-call/start/route.ts`, `src/app/api/twilio/ai-call/route.ts`, `src/app/api/twilio/ai-call/turn/route.ts`, `src/hooks/useTwilioDevice.ts`, `src/contexts/TwilioContext.tsx`, `src/components/Layout/AppLayout.tsx`, `src/components/Calls/IncomingCallBanner.tsx`, `src/components/Calls/IncomingCallModal.tsx`, `src/components/Calls/ActiveCallPopup.tsx`.

### ✨ New: configurable opening greeting

- Added a `greeting_message` field to AI Settings (`src/app/api/user/ai-settings/route.ts`, `src/app/settings/page.tsx`) so the first line the AI speaks is editable in the UI, same as the system prompt already was.

### 🧹 Removed: built-in sample call script

Per your instruction, the previously hardcoded sample call script was removed and replaced with a neutral, empty starter template:

- `src/lib/ai/prompts.ts` — old system-prompt/config constants replaced with `DEFAULT_SYSTEM_PROMPT` / `DEFAULT_AI_CONFIG`, a generic "greet → explain purpose → answer FAQs from a Knowledge Base section → `[TRANSFER]` on request" template with `[Your Company Name]` placeholders.
- `src/lib/ai/llm.ts` — rule-based fallback responses (used only when no LLM API key is configured) de-scripted to generic transfer/decline lines.
- `src/components/AISimulatorModal.tsx` — sample greeting and test chips genericized.
- `src/app/settings/page.tsx` — script-reload button renamed to **"Reset to Default Template"**; System Prompt field relabeled "AI System Prompt & FAQ Knowledge Base".
- `src/app/page.tsx` — hardcoded sample-script badge text replaced with the (now-generic) selected campaign label.
- All other call routes (`ai-call/route.ts`, `ai-call/turn/route.ts`, `api/ai/simulate/route.ts`) updated to import the renamed exports.

**Note:** this only changes the *code defaults*. If your Supabase account already has AI settings saved from before, your account still has the old script text stored (`user_metadata.ai_settings`) — use the new "Reset to Default Template" button in Settings if you want to clear it, or just paste your real script/FAQs over it, same as before.

### ✅ Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean production build, no errors.
- Not yet tested against a live Twilio call — recommend placing a real test campaign call and confirming: AI answers → states purpose → answers a FAQ → says "transfer me" → your softphone rings and shows the lead's name.
