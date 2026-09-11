// Per-user SIP endpoint provisioning for browser/WebRTC calling.
//
// Mirrors the old Twilio Client model (identity = Supabase user UUID, incoming
// calls routed to <Client>{userId}</Client>) but for SignalWire's SIP-over-
// WebSocket approach: each user gets their own SIP username/password pair so a
// raw digest credential is never shared across users or exposed more broadly
// than it needs to be. Created lazily on first request and cached in
// `user_sip_credentials` (see supabase-migration-005-signalwire-sip.sql).
import { randomBytes } from 'crypto';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getSignalWireConfig, signalWireBasicAuth } from './config';

export interface SipCredential {
    username: string;
    password: string;
}

/** Deterministic, SIP-safe username for a given Supabase user id. */
export function sipUsernameFor(userId: string): string {
    return `u${userId.replace(/-/g, '').slice(0, 24)}`;
}

async function createSignalWireSipEndpoint(username: string, password: string): Promise<void> {
    const { space } = getSignalWireConfig();
    // call_request_url is the SIP-endpoint analog of a Twilio Application's Voice
    // Request URL: SignalWire fetches LaML from it to control this endpoint's own
    // outbound-originated calls (mode/recording/whisper decisions), same role
    // /api/signalwire/webhook used to play via the TwiML App tied to Device.connect().
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    const webhookUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/api/signalwire/webhook` : undefined;

    const res = await fetch(`https://${space}/api/relay/rest/endpoints/sip`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${signalWireBasicAuth()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username,
            password,
            caller_id: 'Netro Scale',
            encryption: 'optional',
            ...(webhookUrl ? { call_request_url: webhookUrl, call_request_method: 'POST' } : {}),
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to create SignalWire SIP endpoint (${res.status}): ${body}`);
    }
}

/** Reverse lookup used by the webhook to recover which user placed an outgoing call. */
export async function getUserIdForSipUsername(sipUsername: string): Promise<string | null> {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
        .from('user_sip_credentials')
        .select('user_id')
        .eq('sip_username', sipUsername)
        .maybeSingle();
    return data?.user_id || null;
}

/**
 * Returns this user's SIP credential, creating both the SignalWire endpoint and
 * the Supabase record on first call. Safe to call on every token request.
 */
export async function getOrCreateSipCredential(userId: string): Promise<SipCredential> {
    const supabase = createSupabaseAdmin();
    const username = sipUsernameFor(userId);

    const { data: existing } = await supabase
        .from('user_sip_credentials')
        .select('sip_username, sip_password')
        .eq('user_id', userId)
        .maybeSingle();

    if (existing?.sip_password) {
        return { username: existing.sip_username, password: existing.sip_password };
    }

    const password = randomBytes(18).toString('base64url');
    await createSignalWireSipEndpoint(username, password);

    const { error } = await supabase
        .from('user_sip_credentials')
        .upsert({ user_id: userId, sip_username: username, sip_password: password }, { onConflict: 'user_id' });

    if (error) {
        console.error('[SIP Credentials] Failed to persist new credential:', error);
    }

    return { username, password };
}
