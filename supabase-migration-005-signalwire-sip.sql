-- ============================================
-- SignalWire SIP credentials (Twilio -> SignalWire migration)
-- Run this in Supabase SQL Editor after supabase-migration-004-multi-tenant.sql
-- ============================================

-- Replaces Twilio's AccessToken/VoiceGrant model (a short-lived signed JWT
-- minted per request, never a stored secret) with SignalWire's SIP-over-
-- WebSocket approach, which needs an actual SIP username/password pair per
-- user. Created lazily on first token request (see
-- src/lib/signalwire/sipCredentials.ts) and read back on every subsequent one
-- so the same browser softphone identity is reused.
--
-- RLS is enabled with NO policies for anon/authenticated — this table holds a
-- real SIP password, not a token, so it must only ever be readable through the
-- service-role key (src/lib/supabase/admin.ts), never directly from a
-- browser session. Do not add a "users can view own" policy here.
CREATE TABLE IF NOT EXISTS user_sip_credentials (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    sip_username TEXT NOT NULL UNIQUE,
    sip_password TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_sip_credentials ENABLE ROW LEVEL SECURITY;
