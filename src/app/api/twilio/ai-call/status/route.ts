import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { updateCall, getCall, getAllActiveCalls, LiveAICall } from '@/lib/ai/callStore';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { upsertCallHistory, CallHistoryStatus } from '@/lib/callHistory';
import { syncCallToCrm } from '@/lib/crm/callSync';

export const maxDuration = 60;

const TERMINAL_STATUSES: Record<string, CallHistoryStatus> = {
    completed: 'completed',
    busy: 'busy',
    'no-answer': 'no-answer',
    failed: 'failed',
    canceled: 'canceled',
    cancelled: 'canceled',
};

// Extract params from either POST form data or GET query params
async function extractParams(request: NextRequest): Promise<Record<string, string>> {
    const params: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value;
    });

    if (request.method === 'POST') {
        try {
            const contentType = request.headers.get('content-type') || '';
            if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                const formData = await request.formData();
                formData.forEach((value, key) => {
                    params[key] = value.toString();
                });
            } else if (contentType.includes('application/json')) {
                const json = await request.json();
                Object.entries(json).forEach(([k, v]) => {
                    if (v !== undefined && v !== null) params[k] = String(v);
                });
            } else {
                const rawText = await request.text();
                const searchParams = new URLSearchParams(rawText);
                searchParams.forEach((value, key) => {
                    params[key] = value;
                });
            }
        } catch (e) {
            console.error('[AI Status Webhook] Param extraction error:', e);
        }
    }
    return params;
}

// Twilio Status Callback & Answering Machine Detection (AMD) Webhook
export async function POST(request: NextRequest) {
    try {
        const params = await extractParams(request);
        const callSid = params['CallSid'] || params['callSid'] || '';
        const callStatus = (params['CallStatus'] || params['callStatus'] || '').toLowerCase();
        const answeredBy = (params['AnsweredBy'] || params['answeredBy'] || '').toLowerCase();
        const callDuration = parseInt(params['CallDuration'] || params['Duration'] || '0', 10);
        const agentUserId = params['agentUserId'] || params['userId'] || '';

        console.log(`[AI Call Status Callback] CallSid: ${callSid}, Status: ${callStatus}, AnsweredBy: ${answeredBy}, Duration: ${callDuration}`);

        if (!callSid) {
            return NextResponse.json({ received: true });
        }

        const updates: Partial<LiveAICall> = {};

        // 1. Answering Machine Detection (AMD)
        if (answeredBy) {
            updates.answeredBy = answeredBy as any;
            if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
                updates.status = 'voicemail';
                updates.currentStage = 'voicemail';
                console.log(`[AI Call AMD] Answering machine detected for ${callSid} (${answeredBy}). Terminating call gracefully.`);

                // Terminate call on Twilio side so the queue advances immediately
                try {
                    const accountSid = process.env.TWILIO_ACCOUNT_SID;
                    const apiKey = process.env.TWILIO_API_KEY;
                    const apiSecret = process.env.TWILIO_API_SECRET;
                    if (accountSid && apiKey && apiSecret) {
                        const client = twilio(apiKey, apiSecret, { accountSid });
                        await client.calls(callSid).update({ status: 'completed' });
                    }
                } catch (e) {
                    console.warn(`[AI Call AMD] Error terminating voicemail call ${callSid}:`, e);
                }
            } else if (answeredBy === 'human') {
                updates.currentStage = 'greeting';
            }
        }

        // 2. Call Status Updates
        if (callStatus === 'ringing') {
            updates.status = 'ringing';
            updates.currentStage = 'ringing';
        } else if (callStatus === 'in-progress') {
            updates.status = 'in-progress';
            if (!updates.currentStage || updates.currentStage === 'initiating' || updates.currentStage === 'ringing') {
                updates.currentStage = 'greeting';
            }
        } else if (callStatus === 'completed') {
            const current = getCall(callSid);
            // Preserve voicemail status if detected
            if (current?.status !== 'voicemail' && updates.status !== 'voicemail') {
                updates.status = 'completed';
                updates.currentStage = 'ended';
            }
            updates.duration = callDuration || current?.duration || 0;
        } else if (callStatus === 'busy') {
            updates.status = 'busy';
            updates.currentStage = 'ended';
        } else if (callStatus === 'no-answer') {
            updates.status = 'no-answer';
            updates.currentStage = 'ended';
        } else if (callStatus === 'failed') {
            updates.status = 'failed';
            updates.currentStage = 'ended';
        } else if (callStatus === 'canceled' || callStatus === 'cancelled') {
            updates.status = 'canceled';
            updates.currentStage = 'ended';
        }

        if (callDuration > 0) {
            updates.duration = callDuration;
        }

        if (agentUserId) {
            updates.agentUserId = agentUserId;
        }

        const merged = updateCall(callSid, updates);

        // Mirror terminal states into the permanent call_history table — the in-memory
        // callStore above is telemetry for the live-call UI only (it's wiped on every
        // server restart / cold start and after 2 hours), not durable storage.
        // Check merged.status === 'voicemail' FIRST: AMD can mark a call 'voicemail'
        // on an earlier request than the 'completed' status callback that follows it,
        // and that later 'completed' callback must not stomp the more informative
        // voicemail outcome back to a plain 'completed'.
        const historyStatus: CallHistoryStatus | null =
            merged?.status === 'voicemail' ? 'voicemail' : (TERMINAL_STATUSES[callStatus] || null);
        if (historyStatus && merged?.agentUserId) {
            try {
                const supabase = createSupabaseAdmin();
                await upsertCallHistory(supabase, {
                    callSid,
                    userId: merged.agentUserId,
                    direction: 'outgoing',
                    phoneNumber: merged.to || '',
                    leadName: merged.leadName || null,
                    callMode: 'ai_agent',
                    status: historyStatus,
                    duration: merged.duration || callDuration || 0,
                });
            } catch (e) {
                console.error('[AI Call Status] Failed to write call_history:', e);
            }

            // AI-agent calls already have a text transcript from the turn-by-turn
            // conversation — no audio recording to transcribe (this call path doesn't
            // set Twilio's `record` option), so pass it straight through.
            const transcript = (merged.turns || [])
                .map((t) => `${t.role === 'user' ? 'Customer' : 'AI Agent'}: ${t.text}`)
                .join('\n');
            await syncCallToCrm({
                userId: merged.agentUserId,
                phoneNumber: merged.to || '',
                type: historyStatus === 'voicemail' ? 'voicemail' : 'call',
                direction: 'outgoing',
                leadName: merged.leadName || null,
                leadEmail: merged.leadEmail || null,
                transcript,
            });
        }

        return NextResponse.json({ success: true, callSid });
    } catch (err: any) {
        console.error('[AI Call Status Callback Error]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// Frontend Polling Endpoint: GET /api/twilio/ai-call/status?callSid=CA... or ?callSids=CA1,CA2
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const callSid = searchParams.get('callSid');
        const callSids = searchParams.get('callSids');
        const agentUserId = searchParams.get('agentUserId');

        // 1. Single Call Sid Query
        if (callSid) {
            let call = getCall(callSid);

            // If not found in memory, try fetching live status from Twilio REST API
            if (!call || call.status === 'initiated' || call.status === 'ringing') {
                try {
                    const accountSid = process.env.TWILIO_ACCOUNT_SID;
                    const apiKey = process.env.TWILIO_API_KEY;
                    const apiSecret = process.env.TWILIO_API_SECRET;
                    if (accountSid && apiKey && apiSecret) {
                        const client = twilio(apiKey, apiSecret, { accountSid });
                        const twCall = await client.calls(callSid).fetch();
                        
                        let mappedStatus: LiveAICall['status'] = 'in-progress';
                        if (twCall.status === 'queued') mappedStatus = 'initiated';
                        else if (twCall.status === 'ringing') mappedStatus = 'ringing';
                        else if (twCall.status === 'in-progress') mappedStatus = 'in-progress';
                        else if (twCall.status === 'completed') mappedStatus = 'completed';
                        else if (twCall.status === 'busy') mappedStatus = 'busy';
                        else if (twCall.status === 'no-answer') mappedStatus = 'no-answer';
                        else if (twCall.status === 'failed') mappedStatus = 'failed';
                        else if (twCall.status === 'canceled') mappedStatus = 'canceled';

                        const duration = parseInt(twCall.duration || '0', 10);
                        call = updateCall(callSid, {
                            status: mappedStatus,
                            duration: duration || (call?.duration || 0),
                            to: twCall.to,
                            from: twCall.from,
                        }) || undefined;
                    }
                } catch (e) {
                    console.warn(`[AI Status API] Could not fetch Twilio call ${callSid}:`, e);
                }
            }

            if (!call) {
                return NextResponse.json({ error: 'Call not found' }, { status: 404 });
            }

            return NextResponse.json({ success: true, call });
        }

        // 2. Batch Call Sids Query (for AutoDialer batch polling)
        if (callSids) {
            const sidList = callSids.split(',').map(s => s.trim()).filter(Boolean);
            const results: Record<string, LiveAICall> = {};

            for (const sid of sidList) {
                const call = getCall(sid);
                if (call) {
                    results[sid] = call;
                }
            }

            return NextResponse.json({ success: true, calls: results });
        }

        // 3. All Active Calls Query
        const all = getAllActiveCalls(agentUserId || undefined);
        return NextResponse.json({ success: true, calls: all });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
