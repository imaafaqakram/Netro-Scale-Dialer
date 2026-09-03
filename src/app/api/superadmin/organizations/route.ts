import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessSuperAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

// Platform scope: every organization, not just the caller's own. Only usable
// by super_admins (super_admins table, see supabase-migration-004-multi-tenant.sql)
// — a role that is deliberately separate from any per-org role.

export async function GET() {
    const role = await getCurrentUserRole();
    if (!canAccessSuperAdmin(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createSupabaseAdmin();
    const { data: orgs, error } = await admin
        .from('organizations')
        .select('id, name, suspended, created_at')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Superadmin Orgs] Failed to list organizations:', error);
        return NextResponse.json({ error: 'Failed to list organizations' }, { status: 500 });
    }

    const { data: members } = await admin.from('organization_members').select('org_id');
    const memberCounts = new Map<string, number>();
    for (const m of members || []) {
        memberCounts.set(m.org_id, (memberCounts.get(m.org_id) || 0) + 1);
    }

    const enriched = (orgs || []).map((o) => ({
        id: o.id,
        name: o.name,
        suspended: o.suspended,
        createdAt: o.created_at,
        memberCount: memberCounts.get(o.id) || 0,
    }));

    return NextResponse.json({ organizations: enriched });
}

// POST: create a new organization and invite its first org_admin in one step
// (an org with no admin at all would be unmanageable by anyone but a super
// admin, so this always seeds one).
export async function POST(request: NextRequest) {
    const role = await getCurrentUserRole();
    if (!canAccessSuperAdmin(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const name = (body.name || '').toString().trim();
    const adminEmail = (body.adminEmail || '').toString().trim().toLowerCase();

    if (!name) {
        return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        return NextResponse.json({ error: "A valid admin email is required" }, { status: 400 });
    }

    const admin = createSupabaseAdmin();

    const { data: org, error: orgError } = await admin
        .from('organizations')
        .insert({ name, created_by: role!.userId })
        .select()
        .single();

    if (orgError || !org) {
        console.error('[Superadmin Orgs] Failed to create organization:', orgError);
        return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(adminEmail);
    if (inviteError || !invited?.user) {
        console.error('[Superadmin Orgs] Failed to invite admin:', inviteError);
        // The organization was already created — leave it in place rather than
        // rolling back, and report clearly so the operator can add an admin to
        // it by hand (or retry) instead of losing track of a half-created org.
        return NextResponse.json({
            error: inviteError?.message || 'Organization created, but the admin invite failed. Add an admin to it manually.',
            organization: org,
        }, { status: 207 });
    }

    const { error: memberError } = await admin.from('organization_members').insert({
        org_id: org.id,
        user_id: invited.user.id,
        role: 'org_admin',
    });

    if (memberError) {
        console.error('[Superadmin Orgs] Failed to attach admin to organization:', memberError);
        return NextResponse.json({
            error: 'Organization created and admin invited, but could not be linked. Add them manually.',
            organization: org,
        }, { status: 207 });
    }

    return NextResponse.json({ success: true, organization: org, adminUserId: invited.user.id });
}
