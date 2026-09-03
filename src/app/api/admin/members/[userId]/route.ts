import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

async function assertNotLastOrgAdmin(admin: ReturnType<typeof createSupabaseAdmin>, orgId: string, excludingUserId: string): Promise<boolean> {
    const { count } = await admin
        .from('organization_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('role', 'org_admin')
        .neq('user_id', excludingUserId);
    return (count ?? 0) === 0;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await params;
    const body = await request.json();
    const newRole = body.role === 'org_admin' ? 'org_admin' : body.role === 'agent' ? 'agent' : null;
    if (!newRole) {
        return NextResponse.json({ error: "role must be 'org_admin' or 'agent'" }, { status: 400 });
    }

    const admin = createSupabaseAdmin();

    if (newRole === 'agent') {
        const wouldOrphan = await assertNotLastOrgAdmin(admin, role.orgId, userId);
        if (wouldOrphan) {
            return NextResponse.json({ error: 'Cannot demote the last org admin — promote someone else first' }, { status: 400 });
        }
    }

    const { error } = await admin
        .from('organization_members')
        .update({ role: newRole })
        .eq('org_id', role.orgId) // scoped to the caller's own org — cannot touch another org's membership row
        .eq('user_id', userId);

    if (error) {
        console.error('[Admin Members] Role update failed:', error);
        return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await params;
    const admin = createSupabaseAdmin();

    const wouldOrphan = await assertNotLastOrgAdmin(admin, role.orgId, userId);
    // Only blocks removing the last org_admin if the user being removed IS one —
    // removing an agent never trips this since excluding a non-admin doesn't
    // change the admin count, but check their current role explicitly to avoid
    // relying on that coincidence.
    const { data: target } = await admin
        .from('organization_members')
        .select('role')
        .eq('org_id', role.orgId)
        .eq('user_id', userId)
        .maybeSingle();

    if (target?.role === 'org_admin' && wouldOrphan) {
        return NextResponse.json({ error: 'Cannot remove the last org admin — promote someone else first' }, { status: 400 });
    }

    // Removes org access only — does not delete the underlying Supabase auth
    // account or their call history (which stays keyed by user_id and is still
    // readable by whoever the org's next admin is, since it's org_id-scoped).
    const { error } = await admin
        .from('organization_members')
        .delete()
        .eq('org_id', role.orgId)
        .eq('user_id', userId);

    if (error) {
        console.error('[Admin Members] Remove failed:', error);
        return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
