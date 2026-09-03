import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Permanent, server-side call history. Rows are written by Twilio status
// callbacks (src/app/api/twilio/call-status/route.ts and
// src/app/api/twilio/ai-call/status/route.ts), never by the client — this route
// only reads/deletes. RLS (call_history policies in
// supabase-migration-003-call-history.sql) scopes every query to the
// authenticated user automatically.

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
        const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

        const { data, error, count } = await supabase
            .from('call_history')
            .select('id, call_sid, direction, phone_number, lead_name, call_mode, status, duration, started_at', { count: 'exact' })
            .eq('user_id', user.id)
            .order('started_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Call History] Fetch error:', error);
            return NextResponse.json({ error: 'Failed to fetch call history' }, { status: 500 });
        }

        const entries = (data || []).map((row) => ({
            id: row.id,
            callSid: row.call_sid,
            direction: row.direction,
            phoneNumber: row.phone_number,
            leadName: row.lead_name,
            callMode: row.call_mode,
            status: row.status,
            duration: row.duration,
            timestamp: row.started_at,
        }));

        return NextResponse.json({ entries, total: count ?? entries.length, limit, offset });
    } catch (error) {
        console.error('[Call History] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/user/call-history?id=<uuid>  -> delete one entry
// DELETE /api/user/call-history?all=true   -> delete every entry for this user
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const all = searchParams.get('all') === 'true';

        if (!id && !all) {
            return NextResponse.json({ error: 'Provide ?id=<entry id> or ?all=true' }, { status: 400 });
        }

        let query = supabase.from('call_history').delete().eq('user_id', user.id);
        if (id) query = query.eq('id', id);

        const { error } = await query;

        if (error) {
            console.error('[Call History] Delete error:', error);
            return NextResponse.json({ error: 'Failed to delete call history' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Call History] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
