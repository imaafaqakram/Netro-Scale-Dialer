import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { transcribeRecording } from '@/lib/ai/transcribe';
import { summarizeCallTranscript } from '@/lib/ai/llm';
import { upsertCrmRow } from './sheetsCrm';

export interface SyncCallToCrmParams {
    userId: string;
    phoneNumber: string;
    type: 'call' | 'voicemail';
    direction: 'incoming' | 'outgoing';
    leadName?: string | null;
    leadEmail?: string | null;
    /** Already-known text transcript (e.g. AI-agent turn history) — skips audio transcription entirely. */
    transcript?: string | null;
    /** Twilio recording URL to transcribe when no text transcript is already available. */
    recordingUrl?: string | null;
}

// Single entry point for "a call just finished, sync it to the CRM sheet" — called
// from the recording-status webhook (human calls), the voicemail webhook, and the
// AI-agent status webhook (which already has a text transcript from the turn history,
// so it skips straight past audio transcription). Best-effort throughout: every step
// degrades gracefully (missing config, failed transcription, etc.) rather than
// throwing, since this must never be allowed to break the Twilio webhook response
// it's called from.
export async function syncCallToCrm(params: SyncCallToCrmParams): Promise<void> {
    if (!params.userId || params.userId === 'user' || !params.phoneNumber) return;

    try {
        const admin = createSupabaseAdmin();
        const { data: adminUser } = await admin.auth.admin.getUserById(params.userId);
        const aiMeta = adminUser?.user?.user_metadata?.ai_settings || {};

        const sheetId: string = aiMeta.google_sheet_id || '';
        if (!sheetId) return; // nothing configured to sync to — not an error, just off.

        let transcript = params.transcript?.trim() || '';

        if (!transcript && params.recordingUrl) {
            // Pass the user's own Deepgram key explicitly (falls back to the env default
            // inside transcribeRecording if unset) rather than mutating process.env —
            // concurrent webhook requests for different users can run on the same warm
            // Node process, and mutating shared global state would let one user's request
            // leak another user's API key mid-flight.
            const result = await transcribeRecording(params.recordingUrl, aiMeta.deepgram_api_key || undefined);
            transcript = result?.text?.trim() || '';
        }

        const summary = transcript
            ? await summarizeCallTranscript(transcript, {
                  cerebrasKey: aiMeta.cerebras_api_key,
                  replicateToken: aiMeta.replicate_api_token,
              })
            : '';

        await upsertCrmRow(sheetId, {
            phoneNumber: params.phoneNumber,
            name: params.leadName,
            email: params.leadEmail,
            query: summary,
            transcript,
            type: params.type,
            direction: params.direction,
        });
    } catch (e) {
        console.error('[CRM Sync] Failed to sync call to CRM sheet:', e);
    }
}
