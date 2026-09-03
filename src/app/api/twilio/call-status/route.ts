import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { upsertCallHistory, CallHistoryStatus } from '@/lib/callHistory';

// Per-leg status callback attached to the <Number>/<Client> nouns in
// src/app/api/twilio/webhook/route.ts. Twilio calls this multiple times over the
// life of a direct/script-mode call (initiated -> ringing -> answered ->
// completed) with that leg's authoritative CallSid/CallStatus/CallDuration —
// this is the source of truth for call_history, not client-side SDK events
// (which can race or be missed entirely if the tab isn't open).
async function extractParams(request: NextRequest): Promise<Record<string, string>> {
    const params: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value;
    });

    try {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            formData.forEach((value, key) => {
                params[key] = value.toString();
            });
        }
    } catch (e) {
        console.error('[Call Status Webhook] Param extraction error:', e);
    }

    return params;
}

// Maps Twilio's CallStatus to our canonical status. For an incoming call that
// never reached the softphone, "no-answer"/"busy"/"failed"/"canceled" all read
// to the end user as one thing: a missed call.
function mapStatus(callStatus: string, direction: 'incoming' | 'outgoing'): CallHistoryStatus | null {
    switch (callStatus) {
        case 'initiated':
        case 'queued':
        case 'ringing':
            return 'in-progress';
        case 'in-progress':
        case 'answered':
            return 'in-progress';
        case 'completed':
            return 'completed';
        case 'busy':
            return direction === 'incoming' ? 'missed' : 'busy';
        case 'no-answer':
            return direction === 'incoming' ? 'missed' : 'no-answer';
        case 'failed':
            return direction === 'incoming' ? 'missed' : 'failed';
        case 'canceled':
            return direction === 'incoming' ? 'missed' : 'canceled';
        default:
            return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const params = await extractParams(request);
        const callSid = params['CallSid'] || '';
        const callStatus = (params['CallStatus'] || '').toLowerCase();
        const duration = parseInt(params['CallDuration'] || '0', 10);
        const from = params['From'] || '';
        const to = params['To'] || '';

        const userId = params['user_id'] || '';
        const direction = (params['direction'] === 'incoming' ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing';
        const callMode = (params['call_mode'] as 'direct' | 'script' | 'ai_agent') || 'direct';

        if (!callSid || !userId || !callStatus) {
            return NextResponse.json({ ok: true });
        }

        const status = mapStatus(callStatus, direction);
        if (!status) {
            return NextResponse.json({ ok: true });
        }

        // The number that matters for history is whichever side is the actual
        // human/PSTN party, not our own client leg.
        const phoneNumber = direction === 'incoming' ? from : to;

        const supabase = createSupabaseAdmin();
        await upsertCallHistory(supabase, {
            callSid,
            userId,
            direction,
            phoneNumber,
            callMode,
            status,
            duration,
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[Call Status Webhook] Error:', error);
        return NextResponse.json({ ok: true });
    }
}
