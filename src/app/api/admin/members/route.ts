import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

// Org-admin scope: manage users within the caller's OWN organization only.
// A super_admin can also use this (canAccessAdmin allows it) but only for
// their own org membership, if they happen to have one — cross-org
// management lives under /api/superadmin/*, kept as a separate, simpler-to-
// reason-about authorization boundary rather than one route serving both.

export async function GET() {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createSupabaseAdmin();
    const { data: members, error } = await admin
        .from('organization_members')
        .select('user_id, role, created_at')
        .eq('org_id', role.orgId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Admin Members] Failed to list members:', error);
        return NextResponse.json({ error: 'Failed to list members' }, { status: 500 });
    }

    // organization_members only stores user_id — emails live in auth.users,
    // which isn't reachable through the normal public-schema client. Cross-
    // reference via the admin Auth API. Fine at the scale a single org's
    // member list runs at; would need a public.profiles mirror table to stay
    // cheap at thousands of users per org.
    const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) {
        console.error('[Admin Members] Failed to list auth users:', usersError);
    }
    const emailByUserId = new Map((usersPage?.users || []).map((u) => [u.id, u.email || '']));

    const enriched = (members || []).map((m) => ({
        userId: m.user_id,
        role: m.role,
        email: emailByUserId.get(m.user_id) || '',
        createdAt: m.created_at,
    }));

    return NextResponse.json({ members: enriched });
}

export async function POST(request: NextRequest) {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const memberRole = body.role === 'org_admin' ? 'org_admin' : 'agent';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const admin = createSupabaseAdmin();

    // Sends a Supabase-hosted invite email (set-password magic link). Fails
    // with a clear error if the email is already registered — this route
    // doesn't attempt to silently add an existing account to the org, since
    // that account might already belong to a different org (single-org-per-
    // user is enforced by a DB constraint) and silently reassigning someone
    // else's account is not a call this endpoint should make on its own.
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invited?.user) {
        console.error('[Admin Members] Invite failed:', inviteError);
        return NextResponse.json({ error: inviteError?.message || 'Failed to invite user' }, { status: 400 });
    }

    const { error: memberError } = await admin.from('organization_members').insert({
        org_id: role.orgId,
        user_id: invited.user.id,
        role: memberRole,
    });

    if (memberError) {
        console.error('[Admin Members] Failed to add invited user to org:', memberError);
        return NextResponse.json({ error: 'User was invited but could not be added to the organization' }, { status: 500 });
    }

    return NextResponse.json({ success: true, userId: invited.user.id, email });
}
