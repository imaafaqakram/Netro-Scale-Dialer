-- ============================================
-- Server-side, permanent call history
-- Run this in Supabase SQL Editor AFTER supabase-migration.sql and
-- supabase-migration-002-fixes.sql
-- ============================================

-- Replaces the old client-only history (localStorage, capped at 100 entries,
-- silently dropping older calls, per-browser only, and inaccurate for AI-agent
-- calls whose duration/outcome was written before the call even connected).
-- Every row here is written server-side from Twilio's own status callbacks
-- (src/app/api/twilio/call-status/route.ts and
-- src/app/api/twilio/ai-call/status/route.ts) — Twilio's call lifecycle is the
-- source of truth, not client-side EventEmitter listeners that can race or be
-- skipped if the tab isn't open. Rows are kept indefinitely; nothing auto-expires
-- or auto-caps them. A row is removed only via an explicit user delete
-- (DELETE /api/user/call-history).
CREATE TABLE IF NOT EXISTS call_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    call_sid TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    phone_number TEXT NOT NULL,
    lead_name TEXT,
    call_mode TEXT NOT NULL DEFAULT 'direct' CHECK (call_mode IN ('direct', 'script', 'ai_agent')),
    status TEXT NOT NULL DEFAULT 'in-progress' CHECK (status IN ('in-progress', 'completed', 'missed', 'no-answer', 'busy', 'failed', 'canceled', 'voicemail')),
    duration INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE call_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own call history"
    ON call_history FOR SELECT
    USING (auth.uid() = user_id);

-- Webhooks write with the anon/service key and no browser session, same pattern
-- as call_recordings in supabase-migration.sql.
CREATE POLICY "Allow insert call history"
    ON call_history FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow update call history"
    ON call_history FOR UPDATE
    USING (true);

CREATE POLICY "Users can delete own call history"
    ON call_history FOR DELETE
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_call_history_user_id ON call_history(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_history_call_sid ON call_history(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_history_started_at ON call_history(started_at DESC);
