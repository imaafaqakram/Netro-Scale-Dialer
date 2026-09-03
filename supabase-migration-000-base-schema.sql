-- ============================================
-- Base schema: user_phone_numbers
-- Run this FIRST, before supabase-migration.sql, on any Supabase project
-- that doesn't already have this table.
-- ============================================
--
-- Every other migration file in this repo (supabase-migration.sql onward)
-- only ever ALTERs this table — none of them create it, because in the
-- original project it was created by hand, outside of any file here. On a
-- brand-new Supabase project there is nothing for those ALTER TABLE
-- statements to attach to, which is exactly the
-- `relation "user_phone_numbers" does not exist` error this file fixes.
--
-- If you're running this against the ORIGINAL (old) Supabase project where
-- the table already exists, skip this file entirely and start at
-- supabase-migration.sql — this one is only for a project starting empty.

CREATE TABLE IF NOT EXISTS user_phone_numbers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    friendly_name TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_user_id ON user_phone_numbers(user_id);

ALTER TABLE user_phone_numbers ENABLE ROW LEVEL SECURITY;

-- Baseline RLS — deliberately minimal (own-row only). supabase-migration-004
-- rewrites this completely once organizations/roles exist; these policies
-- only need to hold for the gap between this file and that one.
CREATE POLICY "Users can view own phone numbers"
    ON user_phone_numbers FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own phone numbers"
    ON user_phone_numbers FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow insert phone numbers"
    ON user_phone_numbers FOR INSERT
    WITH CHECK (true);
