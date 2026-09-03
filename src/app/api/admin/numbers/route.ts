import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessAdmin } from '@/lib/auth/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

function formatE164(phone: string): string {
    const clean = (phone || '').replace(/[^0-9+]/g, '');
    if (!clean) return '';
    if (clean.startsWith('+')) return clean;
    if (clean.length === 10) return `+1${clean}`;
    if (clean.length === 11 && clean.startsWith('1')) return `+${clean}`;
    return `+${clean}`;
}

// GET: list every phone number belonging to the caller's org, with assignment.
export async function GET() {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createSupabaseAdmin();
    const { data: numbers, error } = await admin
        .from('user_phone_numbers')
        .select('id, phone_number, friendly_name, is_default, user_id, call_recording_enabled, voicemail_enabled')
        .eq('org_id', role.orgId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Admin Numbers] Failed to list numbers:', error);
        return NextResponse.json({ error: 'Failed to list numbers' }, { status: 500 });
    }

    return NextResponse.json({ numbers: numbers || [] });
}

// POST: add a new number to the org, assigned to a specific member.
export async function POST(request: NextRequest) {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const phoneNumber = formatE164(body.phoneNumber || '');
    const assignToUserId = (body.userId || '').toString();
    const friendlyName = (body.friendlyName || '').toString().trim() || null;

    if (!phoneNumber) {
        return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
    }
    if (!assignToUserId) {
        return NextResponse.json({ error: 'A member to assign this number to is required' }, { status: 400 });
    }

    const admin = createSupabaseAdmin();

    // The assignee must actually be a member of the caller's org — otherwise an
    // org_admin could hand one of their numbers to an arbitrary user_id outside
    // their organization.
    const { data: membership } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('org_id', role.orgId)
        .eq('user_id', assignToUserId)
        .maybeSingle();

    if (!membership) {
        return NextResponse.json({ error: 'That user is not a member of your organization' }, { status: 400 });
    }

    const { data: created, error } = await admin
        .from('user_phone_numbers')
        .insert({
            org_id: role.orgId,
            user_id: assignToUserId,
            phone_number: phoneNumber,
            friendly_name: friendlyName,
            is_default: false,
        })
        .select()
        .single();

    if (error) {
        console.error('[Admin Numbers] Failed to add number:', error);
        return NextResponse.json({ error: 'Failed to add number — it may already be in use' }, { status: 500 });
    }

    return NextResponse.json({ success: true, number: created });
}

// PUT: reassign an existing number to a different member of the org.
export async function PUT(request: NextRequest) {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role) || !role?.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const numberId = (body.id || '').toString();
    const newUserId = (body.userId || '').toString();

    if (!numberId || !newUserId) {
        return NextResponse.json({ error: 'id and userId are required' }, { status: 400 });
    }

    const admin = createSupabaseAdmin();

    const { data: membership } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('org_id', role.orgId)
        .eq('user_id', newUserId)
        .maybeSingle();

    if (!membership) {
        return NextResponse.json({ error: 'That user is not a member of your organization' }, { status: 400 });
    }

    const { error } = await admin
        .from('user_phone_numbers')
        .update({ user_id: newUserId })
        .eq('id', numberId)
        .eq('org_id', role.orgId); // scoped to caller's own org

    if (error) {
        console.error('[Admin Numbers] Reassign failed:', error);
        return NextResponse.json({ error: 'Failed to reassign number' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
