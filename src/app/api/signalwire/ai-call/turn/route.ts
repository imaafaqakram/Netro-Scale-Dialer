import { NextRequest, NextResponse, after } from 'next/server';
import { generateAIResponse, ChatMessage } from '@/lib/ai/llm';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { updateCall, CallTurn } from '@/lib/ai/callStore';
import { getPublicAppUrl } from '@/lib/url';

// The round-tripped `history` param (not the store) is this route's real source of
// truth for conversation continuity across turns/instances — this just reshapes it
// for the telemetry store's slightly different turn shape (adds a timestamp).
function toCallTurns(history: ChatMessage[]): CallTurn[] {
    const now = Date.now();
    return history.map((m) => ({ role: m.role as CallTurn['role'], text: m.content, timestamp: now }));
}
import { sipUsernameFor } from '@/lib/signalwire/sipCredentials';
import { getSignalWireConfig } from '@/lib/signalwire/config';

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function twimlResponse(twiml: string): NextResponse {
    console.log(`[SignalWire AI Turn Response]\n${twiml}`);
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    });
}

function buildTransferTwiml(opts: {
    sayVoice: string;
    sayText: string;
    callerId: string;
    agentUserId: string;
    leadName: string;
    customerNumber: string;
}): string {
    const { sayVoice, sayText, callerId, agentUserId, leadName, customerNumber } = opts;
    const { sipDomain } = getSignalWireConfig();
    const sipTarget = `sip:${sipUsernameFor(agentUserId)}@${sipDomain}`;
    return `
        <Response>
            <Say voice="${sayVoice}" language="en-US">${escapeXml(sayText)}</Say>
            <Dial answerOnBridge="true" callerId="${callerId}">
                <Sip>
                    ${sipTarget}
                    <Header name="X-Lead-Name" value="${escapeXml(leadName || 'Unknown Caller')}" />
                    <Header name="X-Customer-Number" value="${escapeXml(customerNumber || callerId)}" />
                </Sip>
            </Dial>
        </Response>
    `;
}

// Check if speech indicates an answering machine / voicemail greeting
function isVoicemailGreeting(speech: string): boolean {
    const s = speech.toLowerCase();
    return (
        s.includes('leave a message') ||
        s.includes('after the tone') ||
        s.includes('at the tone') ||
        s.includes('record your message') ||
        s.includes('not available right now') ||
        s.includes('cannot take your call') ||
        s.includes('can not take your call') ||
        s.includes('mailbox is full') ||
        s.includes('please leave your name') ||
        s.includes('leave your number') ||
        s.includes('voicemail box') ||
        s.includes('voice message')
    );
}

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
            console.error('[AI Turn] Param extraction error:', e);
        }
    }
    return params;
}

export async function POST(request: NextRequest) {
    return handleTurn(request);
}

export async function GET(request: NextRequest) {
    return handleTurn(request);
}

async function handleTurn(request: NextRequest): Promise<NextResponse> {
    try {
        const params = await extractParams(request);
        const callSid = params['CallSid'] || params['callSid'] || '';
        console.log('[AI Turn] Received turn params:', JSON.stringify(params));

        const speechResult = (params['SpeechResult'] || params['speech'] || params['Digits'] || '').trim();
        const agentUserId = params['agentUserId'] || params['userId'] || 'user';
        const callerId = params['callerId'] || process.env.SIGNALWIRE_DEFAULT_NUMBER || '+13072076444';
        const leadName = params['leadName'] || '';
        const customerNumber = params['To'] || params['Called'] || callerId;
        const turnCount = parseInt(params['turnCount'] || '1', 10);
        const historyEncoded = params['history'] || '';

        let history: ChatMessage[] = [];
        try {
            if (historyEncoded) {
                history = JSON.parse(decodeURIComponent(historyEncoded));
            }
        } catch {}

        const appUrl = await getPublicAppUrl(request);

        // 1. Check if customer speech is a Voicemail / Answering Machine Greeting
        if (speechResult && isVoicemailGreeting(speechResult)) {
            console.log(`[AI Turn] Answering machine detected in speech for ${callSid}: "${speechResult}"`);
            if (callSid) {
                const turns = [...toCallTurns(history), { role: 'user' as const, text: `[Voicemail]: ${speechResult}`, timestamp: Date.now() }];
                after(() => updateCall(callSid, { status: 'voicemail', currentStage: 'voicemail', answeredBy: 'machine_start', turns }));
            }

            return twimlResponse(`
                <Response>
                    <Say voice="Polly.Joanna" language="en-US">Hi, this is Netro Scale returning your inquiry. Please call us back at ${escapeXml(callerId)} when it is convenient. Thank you.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 2. If customer was silent or no speech recognized
        if (!speechResult) {
            if (turnCount >= 4) {
                if (callSid) {
                    after(() => updateCall(callSid, { transferredToSoftphone: true, currentStage: 'transferring' }));
                }
                return twimlResponse(buildTransferTwiml({
                    sayVoice: 'Polly.Joanna',
                    sayText: 'Let me connect you directly with a member of our team right now.',
                    callerId,
                    agentUserId,
                    leadName,
                    customerNumber,
                }));
            }

            return twimlResponse(`
                <Response>
                    <Gather input="speech dtmf" timeout="4" action="${appUrl}/api/signalwire/ai-call/turn?agentUserId=${encodeURIComponent(agentUserId)}&amp;callerId=${encodeURIComponent(callerId)}&amp;leadName=${encodeURIComponent(leadName)}&amp;turnCount=${turnCount + 1}&amp;history=${encodeURIComponent(JSON.stringify(history))}">
                        <Say voice="Polly.Joanna" language="en-US">I am still on the line. Can you hear me all right, or would you like me to connect you with a member of our team?</Say>
                    </Gather>
                </Response>
            `);
        }

        // 3. Record customer turn. The round-tripped `history` param is what actually
        // carries conversation continuity forward (see toCallTurns() above) — the
        // callStore write for this turn is deferred and combined with the assistant's
        // reply below, once both halves of the turn are known.
        history.push({ role: 'user', content: speechResult });

        // 4. Look up user's custom AI settings and API keys from Supabase
        let systemPrompt = DEFAULT_SYSTEM_PROMPT;
        let aiVoice = 'Polly.Joanna';
        let userKeys: { cerebrasKey?: string; replicateToken?: string } = {};

        if (agentUserId && agentUserId !== 'user') {
            try {
                const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
                const admin = createSupabaseAdmin();
                const { data: adminUser } = await admin.auth.admin.getUserById(agentUserId);
                const aiMeta = adminUser?.user?.user_metadata?.ai_settings;
                if (aiMeta) {
                    if (aiMeta.system_prompt) systemPrompt = aiMeta.system_prompt;
                    if (aiMeta.ai_voice) aiVoice = aiMeta.ai_voice;
                    userKeys = {
                        cerebrasKey: aiMeta.cerebras_api_key,
                        replicateToken: aiMeta.replicate_api_token,
                    };
                }
            } catch (e) {
                console.warn('[AI Turn] Could not fetch user metadata:', e);
            }
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-8)
        ];

        // 5. Generate AI reply via Multi-Provider Fallback Engine (Cerebras -> Replicate -> DeepSeek -> Rule)
        const aiResponse = await generateAIResponse(messages, userKeys);
        console.log(`[AI Turn] AI generated response (via ${aiResponse.provider}):`, aiResponse.text, 'shouldTransfer:', aiResponse.shouldTransfer);

        history.push({ role: 'assistant', content: aiResponse.text });

        const stage = aiResponse.shouldTransfer ? 'transferring' : (turnCount >= 2 ? 'objection' : 'pitching');
        if (callSid) {
            // Single deferred write covering both halves of this turn (user + AI reply)
            // — runs after the TwiML response is already on its way back to SignalWire,
            // so it adds zero latency to what the caller actually hears.
            after(() =>
                updateCall(callSid, {
                    turns: toCallTurns(history),
                    currentStage: stage,
                    lastSpeech: speechResult,
                    lastAiReply: aiResponse.text,
                    ...(aiResponse.shouldTransfer ? { transferredToSoftphone: true } : {}),
                })
            );
        }

        // 6. Transfer to softphone if triggered
        if (aiResponse.shouldTransfer || turnCount >= 6) {
            return twimlResponse(buildTransferTwiml({
                sayVoice: aiVoice,
                sayText: aiResponse.text,
                callerId,
                agentUserId,
                leadName,
                customerNumber,
            }));
        }

        // 7. Otherwise speak and gather next speech
        const nextTurn = turnCount + 1;
        const nextActionUrl = `${appUrl}/api/signalwire/ai-call/turn?agentUserId=${encodeURIComponent(agentUserId)}&amp;callerId=${encodeURIComponent(callerId)}&amp;leadName=${encodeURIComponent(leadName)}&amp;turnCount=${nextTurn}&amp;history=${encodeURIComponent(JSON.stringify(history))}`;

        return twimlResponse(`
            <Response>
                <Gather input="speech dtmf" timeout="4" speechTimeout="auto" action="${nextActionUrl}">
                    <Say voice="${aiVoice}" language="en-US">${escapeXml(aiResponse.text)}</Say>
                </Gather>
            </Response>
        `);
    } catch (error) {
        console.error('[AI Turn] Fatal error in turn handler:', error);
        // No generic softphone identity to fall back to here (each user's SIP
        // username is a per-account hash, and agentUserId from the try block isn't
        // in scope) — apologize and hang up rather than dialing an unknown target.
        return twimlResponse(`
            <Response>
                <Say voice="Polly.Joanna" language="en-US">Sorry, something went wrong. Please call back and we'll be right with you.</Say>
                <Hangup/>
            </Response>
        `);
    }
}
