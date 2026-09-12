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

async function findSipEndpointIdByUsername(username: string): Promise<string | null> {
    const { space } = getSignalWireConfig();
    const res = await fetch(`https://${space}/api/relay/rest/endpoints/sip`, {
        headers: { Authorization: `Basic ${signalWireBasicAuth()}` },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null) as { data?: Array<{ id: string; username: string }> } | null;
    return json?.data?.find((e) => e.username === username)?.id || null;
}

async function createSignalWireSipEndpoint(username: string, password: string): Promise<void> {
    const { space } = getSignalWireConfig();
    // call_request_url is the SIP-endpoint analog of a Twilio Application's Voice
    // Request URL: SignalWire fetches LaML from it to control this endpoint's own
    // outbound-originated calls (mode/recording/whisper decisions), same role
    // /api/signalwire/webhook used to play via the TwiML App tied to Device.connect().
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    const webhookUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/api/signalwire/webhook` : undefined;
    const body = {
        username,
        password,
        caller_id: 'Netro Scale',
        encryption: 'optional',
        // "default" silently answers-then-busies every outbound INVITE without
        // ever routing to real PSTN termination or creating a Call record --
        // "passthrough" is SignalWire's own documented value for "let this
        // endpoint actually dial out." Found by noticing zero Call resources
        // ever appeared in the account's call log despite full SDP negotiation
        // completing on every attempt.
        call_handler: 'passthrough',
        ...(webhookUrl ? { call_request_url: webhookUrl, call_request_method: 'POST' } : {}),
    };

    const res = await fetch(`https://${space}/api/relay/rest/endpoints/sip`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${signalWireBasicAuth()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (res.ok) return;

    const errText = await res.text().catch(() => '');

    // A prior attempt can leave an orphaned SignalWire endpoint with no matching
    // Supabase row (e.g. the DB write failed after the SignalWire create
    // succeeded) — sipUsernameFor() is deterministic, so retrying lands on the
    // exact same username and SignalWire correctly rejects it as a duplicate.
    // Reconcile by claiming that endpoint with our freshly generated password
    // instead of erroring out forever on every future attempt.
    if (res.status === 422 && errText.includes('already exists')) {
        const existingId = await findSipEndpointIdByUsername(username);
        if (existingId) {
            const putRes = await fetch(`https://${space}/api/relay/rest/endpoints/sip/${existingId}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Basic ${signalWireBasicAuth()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (putRes.ok) return;
            const putErrText = await putRes.text().catch(() => '');
            throw new Error(`Failed to reclaim orphaned SignalWire SIP endpoint (${putRes.status}): ${putErrText}`);
        }
    }

    throw new Error(`Failed to create SignalWire SIP endpoint (${res.status}): ${errText}`);
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
        // Must throw, not just log: a swallowed failure here leaves a real
        // SignalWire SIP endpoint with a password only this function ever knew,
        // now lost — every future call for this user would otherwise silently
        // regenerate a new password and hit SignalWire's "already exists" 422
        // forever, since sipUsernameFor() is deterministic.
        throw new Error(`Failed to persist SIP credential: ${error.message}`);
    }

    return { username, password };
}
