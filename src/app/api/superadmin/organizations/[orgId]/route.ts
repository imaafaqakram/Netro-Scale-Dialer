import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessSuperAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

// PATCH: suspend/unsuspend or rename an organization. Suspension is a soft
// flag (organizations.suspended) — the app doesn't currently enforce it
// anywhere else (see SETUP_GUIDE.md follow-ups); it exists so a super admin
// has somewhere to record "this tenant is paused" without deleting their data.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    const role = await getCurrentUserRole();
    if (!canAccessSuperAdmin(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orgId } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.suspended === 'boolean') updates.suspended = body.suspended;
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    const { error } = await admin.from('organizations').update(updates).eq('id', orgId);

    if (error) {
        console.error('[Superadmin Orgs] Update failed:', error);
        return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
