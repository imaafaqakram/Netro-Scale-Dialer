-- ============================================
-- Multi-tenant foundation: organizations, roles, RLS rewrite
-- Run this in Supabase SQL Editor AFTER migrations 001-003.
-- ============================================
--
-- Role model:
--   super_admin  - platform-level (the SaaS operator's own staff). NOT tied to
--                  any organization. Can see/manage every organization.
--   org_admin    - manages ONE organization: its users and phone numbers.
--   agent        - a regular dialer user inside one organization; sees only
--                  their own numbers/calls unless their org_admin assigns more.
--
-- A user belongs to at most one organization (enforced by the UNIQUE(user_id)
-- constraint below) — this is a single-org-per-user model, not the more complex
-- multi-org-membership pattern, matching what was asked for (an org's admin
-- manages that org's users; a super admin oversees every org).
--
-- Bootstrapping note: there is an unavoidable chicken-and-egg problem for the
-- very first super_admin — no user can grant themselves that role through the
-- app, since nothing exists yet to authorize it. After running this file, run
-- once (replacing with your own user's UUID from Authentication -> Users):
--   insert into super_admins (user_id) values ('YOUR-USER-UUID-HERE');
-- See SETUP_GUIDE.md for the full walkthrough.

-- 1. Organizations (tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    suspended BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Organization membership + per-org role
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('org_admin', 'agent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON organization_members(org_id);

-- 3. Platform-level super admins — deliberately a separate table, not a role
-- value in organization_members, since this is not any organization's employee.
CREATE TABLE IF NOT EXISTS super_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Helper functions (SECURITY DEFINER: they read organization_members/
-- super_admins bypassing RLS internally). Without this, a policy on
-- organization_members that queries organization_members to check the
-- caller's own role would recurse into itself. STABLE so Postgres can cache
-- the result within one query/statement.
-- ============================================

CREATE OR REPLACE FUNCTION is_super_admin(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = check_user_id);
$$;

CREATE OR REPLACE FUNCTION user_org_id(check_user_id UUID)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT org_id FROM organization_members WHERE user_id = check_user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_org_admin(check_user_id UUID, check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM organization_members
        WHERE user_id = check_user_id AND org_id = check_org_id AND role = 'org_admin'
    );
$$;

-- ============================================
-- RLS: organizations
-- ============================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage all organizations"
    ON organizations FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Members can view their own organization"
    ON organizations FOR SELECT
    USING (id = user_org_id(auth.uid()));

-- ============================================
-- RLS: organization_members
-- ============================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage all memberships"
    ON organization_members FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins manage memberships in their own org"
    ON organization_members FOR ALL
    USING (is_org_admin(auth.uid(), org_id))
    WITH CHECK (is_org_admin(auth.uid(), org_id));

CREATE POLICY "Users can view their own membership"
    ON organization_members FOR SELECT
    USING (user_id = auth.uid());

-- ============================================
-- RLS: super_admins (only super admins can even see who the super admins are)
-- ============================================
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage the super admin list"
    ON super_admins FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

-- ============================================
-- Extend existing tables with org_id
-- ============================================
ALTER TABLE user_phone_numbers ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_org_id ON user_phone_numbers(org_id);
CREATE INDEX IF NOT EXISTS idx_call_recordings_org_id ON call_recordings(org_id);
CREATE INDEX IF NOT EXISTS idx_call_history_org_id ON call_history(org_id);

-- ============================================
-- Data migration: bootstrap every existing user into one default organization
-- as org_admin (safe default — nobody who could already manage their own
-- numbers loses that ability), then backfill org_id on their existing rows.
-- No-ops harmlessly on a fresh project with no existing users.
-- ============================================
DO $$
DECLARE
    default_org_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM organization_members LIMIT 1) THEN

        INSERT INTO organizations (name) VALUES ('Default Organization')
        RETURNING id INTO default_org_id;

        INSERT INTO organization_members (org_id, user_id, role)
        SELECT default_org_id, id, 'org_admin' FROM auth.users
        ON CONFLICT (user_id) DO NOTHING;

        UPDATE user_phone_numbers SET org_id = default_org_id WHERE org_id IS NULL;
        UPDATE call_recordings SET org_id = default_org_id WHERE org_id IS NULL;
        UPDATE call_history SET org_id = default_org_id WHERE org_id IS NULL;
    END IF;
END $$;

-- ============================================
-- Rewrite RLS on user_phone_numbers, call_recordings, call_history to be
-- org-aware. Existing policies are dropped dynamically (by whatever they're
-- actually named in this project) rather than by guessed name — this project's
-- original user_phone_numbers RLS was set up outside any migration file this
-- codebase has, so its exact policy names aren't known here, and leaving a
-- stale permissive policy in place alongside new ones would silently defeat
-- the whole point of this rewrite (Postgres RLS policies are OR'd together).
-- ============================================
DO $$
DECLARE
    pol RECORD;
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['user_phone_numbers', 'call_recordings', 'call_history']
    LOOP
        FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
        END LOOP;
    END LOOP;
END $$;

ALTER TABLE user_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_history ENABLE ROW LEVEL SECURITY;

-- user_phone_numbers: numbers are an admin-assigned resource. Agents can see
-- and update their own assignment (e.g. toggling recording/voicemail in
-- Settings, same as before this migration) but not create/delete rows or see
-- another agent's numbers — that's an org_admin action.
CREATE POLICY "Super admins full access to phone numbers"
    ON user_phone_numbers FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins manage their org's phone numbers"
    ON user_phone_numbers FOR ALL
    USING (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id))
    WITH CHECK (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id));

CREATE POLICY "Users view and update their own phone numbers"
    ON user_phone_numbers FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users update their own phone number settings"
    ON user_phone_numbers FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- call_recordings / call_history: written server-side via the service-role
-- key (bypasses RLS entirely), so INSERT stays permissive exactly as before —
-- these policies only govern what a logged-in browser session can see/change.
-- Org admins get oversight visibility across their whole org (e.g. QA'ing
-- calls); agents see only their own.
CREATE POLICY "Super admins full access to call recordings"
    ON call_recordings FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins view their org's call recordings"
    ON call_recordings FOR SELECT
    USING (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id));

CREATE POLICY "Org admins delete their org's call recordings"
    ON call_recordings FOR DELETE
    USING (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id));

CREATE POLICY "Allow insert recordings"
    ON call_recordings FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Users manage their own recordings"
    ON call_recordings FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users update their own recordings"
    ON call_recordings FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete their own recordings"
    ON call_recordings FOR DELETE
    USING (user_id = auth.uid());

CREATE POLICY "Super admins full access to call history"
    ON call_history FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins view their org's call history"
    ON call_history FOR SELECT
    USING (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id));

CREATE POLICY "Org admins delete their org's call history"
    ON call_history FOR DELETE
    USING (org_id IS NOT NULL AND is_org_admin(auth.uid(), org_id));

CREATE POLICY "Allow insert call history"
    ON call_history FOR INSERT
    WITH CHECK (true);

-- Deliberately no blanket USING(true) UPDATE policy here (migration 003 had
-- one, carried forward from call_recordings' existing INSERT pattern) — the
-- public anon key is, by design, shipped to every browser, and a blanket
-- UPDATE policy would let anyone holding it rewrite any tenant's call history
-- via the REST API directly, bypassing this app entirely. The webhooks that
-- upsert this table use the service-role key (src/lib/supabase/admin.ts),
-- which bypasses RLS and needs no policy at all; if that key is ever
-- misconfigured and the client falls back to the anon key, status-update
-- upserts will now correctly fail closed instead of silently succeeding for
-- anyone.

CREATE POLICY "Users view their own call history"
    ON call_history FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users delete their own call history"
    ON call_history FOR DELETE
    USING (user_id = auth.uid());
