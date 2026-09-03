import { createSign } from 'crypto';

// Mints short-lived OAuth2 access tokens for a Google service account using the
// standard JWT-bearer flow (https://developers.google.com/identity/protocols/oauth2/service-account).
// Deliberately hand-rolled with Node's built-in `crypto` instead of the `googleapis`
// npm package: this sandbox can't run `npm install` to update package-lock.json, and
// this codebase's existing convention for every other external provider (Cerebras,
// Replicate, DeepSeek — see src/lib/ai/llm.ts) is a raw fetch() call with zero SDK
// dependency anyway, so this stays consistent with that rather than introducing the
// one exception.
//
// Required env var: GOOGLE_SERVICE_ACCOUNT_KEY — the *entire* contents of the JSON
// key file downloaded from Google Cloud Console (IAM & Admin -> Service Accounts ->
// Keys -> Add Key -> JSON), pasted as-is into one env var. See SETUP_GUIDE.md for the
// full walkthrough of creating it and sharing a target Sheet with it.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

interface ServiceAccountKey {
    client_email: string;
    private_key: string;
}

interface CachedToken {
    accessToken: string;
    expiresAt: number; // ms epoch
}

declare global {
    // eslint-disable-next-line no-var
    var __googleSheetsTokenCache: CachedToken | undefined;
}

function base64url(input: Buffer | string): string {
    return Buffer.from(input as any)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function loadServiceAccountKey(): ServiceAccountKey | null {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.client_email || !parsed.private_key) return null;
        return { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch (e) {
        console.error('[Google Sheets Auth] GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON:', e);
        return null;
    }
}

export function isGoogleSheetsConfigured(): boolean {
    return !!loadServiceAccountKey();
}

// Returns a valid access token, minting/refreshing one only when the cached token is
// missing or within 60s of expiry.
export async function getGoogleAccessToken(): Promise<string | null> {
    const cached = global.__googleSheetsTokenCache;
    if (cached && cached.expiresAt - Date.now() > 60_000) {
        return cached.accessToken;
    }

    const key = loadServiceAccountKey();
    if (!key) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: key.client_email,
        scope: SHEETS_SCOPE,
        aud: TOKEN_URL,
        iat: nowSec,
        exp: nowSec + 3600,
    };

    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

    let signature: string;
    try {
        const signer = createSign('RSA-SHA256');
        signer.update(unsigned);
        signer.end();
        signature = base64url(signer.sign(key.private_key));
    } catch (e) {
        console.error('[Google Sheets Auth] Failed to sign JWT (check private_key formatting):', e);
        return null;
    }

    const assertion = `${unsigned}.${signature}`;

    try {
        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion,
            }),
        });

        if (!res.ok) {
            console.error(`[Google Sheets Auth] Token exchange failed: HTTP ${res.status} — ${await res.text()}`);
            return null;
        }

        const data = await res.json();
        if (!data.access_token) return null;

        global.__googleSheetsTokenCache = {
            accessToken: data.access_token,
            expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        };

        return data.access_token;
    } catch (e) {
        console.error('[Google Sheets Auth] Token exchange error:', e);
        return null;
    }
}
