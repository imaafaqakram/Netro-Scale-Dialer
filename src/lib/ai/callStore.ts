// Real-time In-Memory AI Call Telemetry & Transcript Store

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

// Attach store to NodeJS global to survive hot module reload in dev
declare global {
    // eslint-disable-next-line no-var
    var __aiCallStore: Map<string, LiveAICall> | undefined;
}

if (!global.__aiCallStore) {
    global.__aiCallStore = new Map<string, LiveAICall>();
}

const callStore = global.__aiCallStore;

export function registerCall(params: {
    callSid: string;
    agentUserId: string;
    to: string;
    from: string;
    leadName?: string;
    leadEmail?: string;
    leadId?: string;
}): LiveAICall {
    const now = Date.now();
    const call: LiveAICall = {
        callSid: params.callSid,
        agentUserId: params.agentUserId,
        to: params.to,
        from: params.from,
        leadName: params.leadName || '',
        leadEmail: params.leadEmail || '',
        leadId: params.leadId || '',
        status: 'initiated',
        duration: 0,
        startedAt: now,
        updatedAt: now,
        turns: [],
        currentStage: 'initiating',
        transferredToSoftphone: false,
    };
    callStore.set(params.callSid, call);
    cleanOldCalls();
    return call;
}

export function updateCall(callSid: string, updates: Partial<LiveAICall>): LiveAICall | null {
    const existing = callStore.get(callSid);
    if (!existing) {
        // If not found, create minimal entry
        const now = Date.now();
        const call: LiveAICall = {
            callSid,
            agentUserId: updates.agentUserId || 'user',
            to: updates.to || '',
            from: updates.from || '',
            status: updates.status || 'in-progress',
            duration: updates.duration || 0,
            startedAt: now,
            updatedAt: now,
            turns: updates.turns || [],
            ...updates,
        };
        callStore.set(callSid, call);
        return call;
    }

    const updated: LiveAICall = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
    };

    if (updates.turns) {
        updated.turns = updates.turns;
    }

    callStore.set(callSid, updated);
    return updated;
}

export function addCallTurn(callSid: string, turn: CallTurn, stage?: LiveAICall['currentStage']): LiveAICall | null {
    const existing = callStore.get(callSid);
    if (!existing) return null;

    const turns = [...existing.turns, turn];
    const updates: Partial<LiveAICall> = {
        turns,
        updatedAt: Date.now(),
    };

    if (turn.role === 'user') {
        updates.lastSpeech = turn.text;
    } else if (turn.role === 'assistant') {
        updates.lastAiReply = turn.text;
    }

    if (stage) {
        updates.currentStage = stage;
    }

    const updated = { ...existing, ...updates };
    callStore.set(callSid, updated);
    return updated;
}

export function getCall(callSid: string): LiveAICall | undefined {
    return callStore.get(callSid);
}

export function getAllActiveCalls(agentUserId?: string): LiveAICall[] {
    const all = Array.from(callStore.values());
    if (agentUserId) {
        return all.filter(c => c.agentUserId === agentUserId);
    }
    return all;
}

// Clean calls older than 2 hours to avoid memory leak
function cleanOldCalls() {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [sid, call] of callStore.entries()) {
        if (call.updatedAt < twoHoursAgo) {
            callStore.delete(sid);
        }
    }
}
