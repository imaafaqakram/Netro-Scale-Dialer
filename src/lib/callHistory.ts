import type { SupabaseClient } from '@supabase/supabase-js';

// Canonical call outcome recorded in call_history. SignalWire's own CallStatus values
// map onto this fairly directly — see src/app/api/signalwire/call-status/route.ts and
// src/app/api/signalwire/ai-call/status/route.ts for the mapping.
export type CallHistoryStatus =
    | 'in-progress'
    | 'completed'
    | 'missed'
    | 'no-answer'
    | 'busy'
    | 'failed'
    | 'canceled'
    | 'voicemail';

export interface UpsertCallHistoryParams {
    callSid: string;
    userId: string;
    direction: 'incoming' | 'outgoing';
    phoneNumber: string;
    leadName?: string | null;
    callMode?: 'direct' | 'script' | 'ai_agent';
    status: CallHistoryStatus;
    duration?: number;
}

// Single write path for call_history, called from every SignalWire status callback
// (direct/script calls via /api/signalwire/call-status, AI-agent calls via
// /api/signalwire/ai-call/status). SignalWire calls back multiple times per call
// (initiated -> ringing -> answered -> completed); this upserts by call_sid so
// the row is created once and then progressively updated to its final state,
// never duplicated.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function upsertCallHistory(
    supabase: SupabaseClient,
    params: UpsertCallHistoryParams
): Promise<void> {
    if (!params.callSid || !params.userId) return;

    // user_id is a UUID NOT NULL FK to auth.users — a non-UUID value (e.g. the
    // 'user' placeholder used when a caller's real id couldn't be resolved) would
    // otherwise fail this upsert at the database level and get silently swallowed
    // by the catch below, making a call vanish from history with no visible error
    // anywhere. Fail loudly here instead so it shows up in logs immediately.
    if (!UUID_RE.test(params.userId)) {
        console.error(`[CallHistory] Refusing to upsert ${params.callSid}: userId "${params.userId}" is not a real user UUID (resolution likely failed upstream).`);
        return;
    }

    // Resolve the caller's org so org_admins get oversight visibility into this
    // row (see supabase-migration-004-multi-tenant.sql's "Org admins view
    // their org's call history" policy, which is scoped by org_id). Missing
    // membership (not migrated yet, or a 'user' placeholder id) isn't an
    // error — the row still saves, just without org-level visibility until
    // that's resolved.
    const { data: membership } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', params.userId)
        .maybeSingle();

    const { error } = await supabase
        .from('call_history')
        .upsert(
            {
                call_sid: params.callSid,
                user_id: params.userId,
                org_id: membership?.org_id || null,
                direction: params.direction,
                phone_number: params.phoneNumber || 'Unknown',
                lead_name: params.leadName || null,
                call_mode: params.callMode || 'direct',
                status: params.status,
                duration: Math.max(0, Math.floor(params.duration ?? 0)),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'call_sid' }
        );

    if (error) {
        console.error(`[CallHistory] upsert failed for ${params.callSid}:`, error);
    }
}
