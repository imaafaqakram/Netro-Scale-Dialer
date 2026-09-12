// Plain fetch()-based client for SignalWire's LaML-compatibility REST API.
//
// This replaces an earlier version built on @signalwire/compatibility-api's
// RestClient — that package crashes at import time in Vercel's serverless
// runtime (confirmed: every route importing it returned Vercel's generic
// /500 page instead of even reaching our own try/catch, while routes using
// only plain fetch() against the same API worked fine). Given the whole
// point of the "compatibility" API is that it's wire-compatible with
// Twilio's REST API, talking to it directly costs little extra code and
// removes a dependency that doesn't actually work in this environment.
import { getSignalWireConfig, signalWireBasicAuth } from './config';

export interface SignalWireCall {
    sid: string;
    status: string;
    to: string;
    from: string;
    duration: string | null;
}

export interface SignalWireRecording {
    sid: string;
    call_sid: string;
    status: string;
    source: string;
    channels: number;
    duration: string;
    date_created: string;
}

function apiBase(): string {
    const { space, projectId } = getSignalWireConfig();
    return `https://${space}/api/laml/2010-04-01/Accounts/${projectId}`;
}

async function laml<T>(method: 'GET' | 'POST', path: string, formParams?: Record<string, string | string[] | undefined>): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Basic ${signalWireBasicAuth()}` };
    let body: string | undefined;

    if (method === 'POST' && formParams) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(formParams)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
            else params.append(key, value);
        }
        body = params.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(`${apiBase()}${path}`, { method, headers, body });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SignalWire API ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
}

export async function createCall(params: {
    to: string;
    from: string;
    url: string;
    machineDetection?: boolean;
    machineDetectionTimeout?: number;
    asyncAmdStatusCallback?: string;
    statusCallback?: string;
    statusCallbackEvent?: string[];
}): Promise<SignalWireCall> {
    return laml('POST', '/Calls.json', {
        To: params.to,
        From: params.from,
        Url: params.url,
        MachineDetection: params.machineDetection ? 'Enable' : undefined,
        MachineDetectionTimeout: params.machineDetectionTimeout ? String(params.machineDetectionTimeout) : undefined,
        AsyncAmd: params.machineDetection ? 'true' : undefined,
        AsyncAmdStatusCallback: params.asyncAmdStatusCallback,
        StatusCallback: params.statusCallback,
        StatusCallbackEvent: params.statusCallbackEvent,
    });
}

export async function fetchCall(sid: string): Promise<SignalWireCall> {
    return laml('GET', `/Calls/${encodeURIComponent(sid)}.json`);
}

export async function terminateCall(sid: string): Promise<void> {
    await laml('POST', `/Calls/${encodeURIComponent(sid)}.json`, { Status: 'completed' });
}

export async function listRecentRecordings(params: { dateCreatedAfter: Date; limit: number }): Promise<SignalWireRecording[]> {
    const qs = new URLSearchParams({
        DateCreatedAfter: params.dateCreatedAfter.toISOString(),
        PageSize: String(params.limit),
    });
    const data = await laml<{ recordings: SignalWireRecording[] }>('GET', `/Recordings.json?${qs.toString()}`);
    return data.recordings || [];
}
