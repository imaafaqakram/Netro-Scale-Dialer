-- ============================================
-- Persistent, shared store for live AI-agent call telemetry
-- Run this in Supabase SQL Editor AFTER supabase-migration-003-call-history.sql
-- ============================================

-- Replaces src/lib/ai/callStore.ts's old `global.__aiCallStore` in-memory Map.
--
-- That Map was a Node.js `global`-scoped singleton — a well-known trick for
-- surviving hot-module-reload in local dev, but it does NOT work as a
-- cross-request store in a serverless deployment (Vercel). A single AI call
-- spans multiple separate HTTP requests over its lifetime — /ai-call/start
-- (registers the call), /api/signalwire/ai-call (greeting), one
-- /api/signalwire/ai-call/turn hit per turn, and /api/signalwire/ai-call/status
-- (final outcome) — and Vercel is free to route each one to a different,
-- independent function instance with its own empty in-memory Map. In practice
-- this meant the *final* status callback frequently saw a call it had never
-- registered, fell back to a placeholder identity, and every call_history
-- write for that identity failed (or silently wrote garbage) — this table is
-- the fix: real shared state, visible to every instance.
CREATE TABLE IF NOT EXISTS ai_call_sessions (
    call_sid TEXT PRIMARY KEY,
    -- Loosely typed on purpose (not UUID/FK): unlike call_history, this table
    -- also has to tolerate the 'user' placeholder that shows up when a caller
    -- couldn't resolve a real Supabase user id yet.
    agent_user_id TEXT NOT NULL DEFAULT 'user',
    to_number TEXT NOT NULL DEFAULT '',
    from_number TEXT NOT NULL DEFAULT '',
    lead_name TEXT,
    lead_email TEXT,
    lead_id TEXT,
    status TEXT NOT NULL DEFAULT 'initiated',
    answered_by TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    turns JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_speech TEXT,
    last_ai_reply TEXT,
    current_stage TEXT,
    transferred_to_softphone BOOLEAN NOT NULL DEFAULT false,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_call_sessions ENABLE ROW LEVEL SECURITY;

-- Every read/write on this table goes through createSupabaseAdmin() (the
-- service-role key), which bypasses RLS entirely — these policies exist only
-- as a safety net if a non-admin client ever touches this table.
CREATE POLICY "Service role full access to ai_call_sessions"
    ON ai_call_sessions FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_call_sessions_agent_user_id ON ai_call_sessions(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_sessions_updated_at ON ai_call_sessions(updated_at DESC);
