import type { SupabaseClient } from '@supabase/supabase-js';

// Canonical call outcome recorded in call_history. Twilio's own CallStatus values
// map onto this fairly directly — see src/app/api/twilio/call-status/route.ts and
// src/app/api/twilio/ai-call/status/route.ts for the mapping.
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

// Single write path for call_history, called from every Twilio status callback
// (direct/script calls via /api/twilio/call-status, AI-agent calls via
// /api/twilio/ai-call/status). Twilio calls back multiple times per call
// (initiated -> ringing -> answered -> completed); this upserts by call_sid so
// the row is created once and then progressively updated to its final state,
// never duplicated.
export async function upsertCallHistory(
    supabase: SupabaseClient,
    params: UpsertCallHistoryParams
): Promise<void> {
    if (!params.callSid || !params.userId) return;

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
