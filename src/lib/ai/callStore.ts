// Shared AI-call telemetry & transcript store — backed by Supabase
// (ai_call_sessions, see supabase-migration-006-ai-call-sessions.sql).
//
// This used to be a plain `Map` attached to `global`, which only works as a
// cross-request store on a long-lived Node process (or local dev's hot-reload
// survival trick). On Vercel, each of a call's lifecycle requests — /start,
// the greeting, every /turn, and the final /status — can land on a different
// serverless instance with its own empty Map, so the final status callback
// routinely saw a call it had never registered and every call_history write
// for it silently failed. A real shared store fixes that.
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export interface CallTurn {
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp: number;
}

export interface LiveAICall {
    callSid: string;
    agentUserId: string;
    to: string;
    from: string;
    leadName?: string;
    leadEmail?: string;
    leadId?: string;
    status: 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled' | 'voicemail';
    answeredBy?: 'human' | 'machine_start' | 'machine_end_beep' | 'machine_end_silence' | 'fax' | 'unknown';
    duration: number;
    startedAt: number;
    updatedAt: number;
    turns: CallTurn[];
    lastSpeech?: string;
    lastAiReply?: string;
    currentStage?: 'initiating' | 'ringing' | 'greeting' | 'pitching' | 'objection' | 'qualifying' | 'transferring' | 'voicemail' | 'ended';
    transferredToSoftphone?: boolean;
    error?: string;
}

interface Row {
    call_sid: string;
    agent_user_id: string;
    to_number: string;
    from_number: string;
    lead_name: string | null;
    lead_email: string | null;
    lead_id: string | null;
    status: string;
    answered_by: string | null;
    duration: number;
    turns: CallTurn[];
    last_speech: string | null;
    last_ai_reply: string | null;
    current_stage: string | null;
    transferred_to_softphone: boolean;
    error: string | null;
    started_at: string;
    updated_at: string;
}

function fromRow(r: Row): LiveAICall {
    return {
        callSid: r.call_sid,
        agentUserId: r.agent_user_id,
        to: r.to_number,
        from: r.from_number,
        leadName: r.lead_name || undefined,
        leadEmail: r.lead_email || undefined,
        leadId: r.lead_id || undefined,
        status: r.status as LiveAICall['status'],
        answeredBy: (r.answered_by as LiveAICall['answeredBy']) || undefined,
        duration: r.duration,
        turns: r.turns || [],
        lastSpeech: r.last_speech || undefined,
        lastAiReply: r.last_ai_reply || undefined,
        currentStage: (r.current_stage as LiveAICall['currentStage']) || undefined,
        transferredToSoftphone: r.transferred_to_softphone,
        error: r.error || undefined,
        startedAt: new Date(r.started_at).getTime(),
        updatedAt: new Date(r.updated_at).getTime(),
    };
}

// Only the columns a partial update actually touches — omitting a field here
// must mean "leave it as-is in the DB", never "clear it to null", since every
// call site only passes what it knows changed.
function toRowPatch(updates: Partial<LiveAICall>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (updates.agentUserId !== undefined) patch.agent_user_id = updates.agentUserId;
    if (updates.to !== undefined) patch.to_number = updates.to;
    if (updates.from !== undefined) patch.from_number = updates.from;
    if (updates.leadName !== undefined) patch.lead_name = updates.leadName;
    if (updates.leadEmail !== undefined) patch.lead_email = updates.leadEmail;
    if (updates.leadId !== undefined) patch.lead_id = updates.leadId;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.answeredBy !== undefined) patch.answered_by = updates.answeredBy;
    if (updates.duration !== undefined) patch.duration = updates.duration;
    if (updates.turns !== undefined) patch.turns = updates.turns;
    if (updates.lastSpeech !== undefined) patch.last_speech = updates.lastSpeech;
    if (updates.lastAiReply !== undefined) patch.last_ai_reply = updates.lastAiReply;
    if (updates.currentStage !== undefined) patch.current_stage = updates.currentStage;
    if (updates.transferredToSoftphone !== undefined) patch.transferred_to_softphone = updates.transferredToSoftphone;
    if (updates.error !== undefined) patch.error = updates.error;
    return patch;
}

export async function registerCall(params: {
    callSid: string;
    agentUserId: string;
    to: string;
    from: string;
    leadName?: string;
    leadEmail?: string;
    leadId?: string;
}): Promise<LiveAICall> {
    const supabase = createSupabaseAdmin();
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('ai_call_sessions')
        .upsert(
            {
                call_sid: params.callSid,
                agent_user_id: params.agentUserId,
                to_number: params.to,
                from_number: params.from,
                lead_name: params.leadName || null,
                lead_email: params.leadEmail || null,
                lead_id: params.leadId || null,
                status: 'initiated',
                duration: 0,
                turns: [],
                current_stage: 'initiating',
                transferred_to_softphone: false,
                started_at: now,
                updated_at: now,
            },
            { onConflict: 'call_sid' }
        )
        .select()
        .single();

    if (error || !data) {
        console.error(`[CallStore] registerCall failed for ${params.callSid}:`, error?.message);
        // Fall back to an in-memory-only shape so the caller (which doesn't
        // otherwise check for failure) still gets something usable this request.
        return {
            callSid: params.callSid,
            agentUserId: params.agentUserId,
            to: params.to,
            from: params.from,
            leadName: params.leadName,
            leadEmail: params.leadEmail,
            leadId: params.leadId,
            status: 'initiated',
            duration: 0,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            turns: [],
            currentStage: 'initiating',
            transferredToSoftphone: false,
        };
    }
    return fromRow(data as Row);
}

export async function updateCall(callSid: string, updates: Partial<LiveAICall>): Promise<LiveAICall | null> {
    const supabase = createSupabaseAdmin();
    const patch = toRowPatch(updates);
    patch.updated_at = new Date().toISOString();

    // upsert (not update): a status/turn callback can legitimately arrive for a
    // call_sid this store has never seen yet (e.g. an inbound call, or the very
    // first webhook hit racing ahead of registerCall's own write) — matches the
    // old Map's "if not found, create minimal entry" behavior.
    const { data, error } = await supabase
        .from('ai_call_sessions')
        .upsert({ call_sid: callSid, ...patch }, { onConflict: 'call_sid' })
        .select()
        .single();

    if (error || !data) {
        console.error(`[CallStore] updateCall failed for ${callSid}:`, error?.message);
        return null;
    }
    return fromRow(data as Row);
}

export async function getCall(callSid: string): Promise<LiveAICall | undefined> {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
        .from('ai_call_sessions')
        .select('*')
        .eq('call_sid', callSid)
        .maybeSingle();

    if (error) {
        console.error(`[CallStore] getCall failed for ${callSid}:`, error.message);
        return undefined;
    }
    return data ? fromRow(data as Row) : undefined;
}

export async function getAllActiveCalls(agentUserId?: string): Promise<LiveAICall[]> {
    const supabase = createSupabaseAdmin();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    let query = supabase
        .from('ai_call_sessions')
        .select('*')
        .gte('updated_at', twoHoursAgo)
        .order('started_at', { ascending: false })
        .limit(200);
    if (agentUserId) query = query.eq('agent_user_id', agentUserId);

    const { data, error } = await query;
    if (error) {
        console.error('[CallStore] getAllActiveCalls failed:', error.message);
        return [];
    }
    return (data || []).map((r) => fromRow(r as Row));
}
