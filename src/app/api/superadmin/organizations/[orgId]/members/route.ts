import { NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessSuperAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

// Cross-org member visibility for oversight — the super-admin equivalent of
// GET /api/admin/members, but for any organization, not just the caller's own.
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
    const role = await getCurrentUserRole();
    if (!canAccessSuperAdmin(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orgId } = await params;
    const admin = createSupabaseAdmin();

    const { data: members, error } = await admin
        .from('organization_members')
        .select('user_id, role, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Superadmin Org Members] Failed to list members:', error);
        return NextResponse.json({ error: 'Failed to list members' }, { status: 500 });
    }

    const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) {
        console.error('[Superadmin Org Members] Failed to list auth users:', usersError);
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
