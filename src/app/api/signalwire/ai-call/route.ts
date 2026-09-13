import { NextRequest, NextResponse, after } from 'next/server';
import { generateInitialGreeting, DEFAULT_AI_CONFIG } from '@/lib/ai/prompts';
import { updateCall } from '@/lib/ai/callStore';
import { getPublicAppUrl } from '@/lib/url';

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function twimlResponse(twiml: string): NextResponse {
    console.log(`[SignalWire AI Entry Response]\n${twiml}`);
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    });
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
            console.error('[AI Entry] Param extraction error:', e);
        }
    }
    return params;
}

export async function POST(request: NextRequest) {
    return handleEntry(request);
}

export async function GET(request: NextRequest) {
    return handleEntry(request);
}

async function handleEntry(request: NextRequest): Promise<NextResponse> {
    try {
        const params = await extractParams(request);
        const callSid = params['CallSid'] || params['callSid'] || '';
        const answeredBy = (params['AnsweredBy'] || '').toLowerCase();
        console.log('[AI Entry] Initiating AI call with params:', JSON.stringify(params));

        const agentUserId = params['agentUserId'] || params['userId'] || 'user';
        const callerId = params['callerId'] || process.env.SIGNALWIRE_DEFAULT_NUMBER || '+13072076444';
        const leadName = params['leadName'] || '';

        // If SignalWire's AMD already signaled voicemail on connect
        if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
            if (callSid) {
                // after(): don't make SignalWire wait on this write before it gets
                // the Hangup TwiML — see the identical note below.
                after(() => updateCall(callSid, { status: 'voicemail', currentStage: 'voicemail', answeredBy: answeredBy as any }));
            }
            return twimlResponse(`
                <Response>
                    <Say voice="Polly.Joanna" language="en-US">Hi, this is Netro Scale returning your inquiry. We missed you, so please call us back at ${escapeXml(callerId)} when it is convenient. Thank you.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // Base URL for callback
        const appUrl = await getPublicAppUrl(request);

        // Look up this user's saved AI settings (greeting, voice, custom script) from Supabase
        let greeting = generateInitialGreeting();
        let aiVoice = 'Polly.Joanna';
        if (agentUserId && agentUserId !== 'user') {
            try {
                const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
                const admin = createSupabaseAdmin();
                const { data: adminUser } = await admin.auth.admin.getUserById(agentUserId);
                const aiMeta = adminUser?.user?.user_metadata?.ai_settings;
                if (aiMeta) {
                    if (aiMeta.ai_voice) aiVoice = aiMeta.ai_voice;
                    if (aiMeta.greeting_message) {
                        greeting = aiMeta.greeting_message;
                    } else {
                        greeting = generateInitialGreeting({ companyName: DEFAULT_AI_CONFIG.companyName });
                    }
                }
            } catch (e) {
                console.warn('[AI Entry] Could not fetch user AI settings:', e);
            }
        }

        // Personalize the greeting with the lead's name when we have one
        if (leadName) {
            greeting = `Hi, is this ${leadName}? ${greeting}`;
        }

        // Update live call store with status and initial greeting turn. Backgrounded
        // via after(): this is telemetry, not something the caller's Gather/Say
        // response should ever wait on — Vercel still guarantees it completes before
        // the function instance is torn down, unlike a bare unawaited promise.
        if (callSid) {
            after(() =>
                updateCall(callSid, {
                    status: 'in-progress',
                    currentStage: 'greeting',
                    leadName: leadName || undefined,
                    turns: [{ role: 'assistant', text: greeting, timestamp: Date.now() }],
                })
            );
        }

        const turnActionUrl = `${appUrl}/api/signalwire/ai-call/turn?agentUserId=${encodeURIComponent(agentUserId)}&amp;callerId=${encodeURIComponent(callerId)}&amp;leadName=${encodeURIComponent(leadName)}&amp;turnCount=1`;

        return twimlResponse(`
            <Response>
                <Gather input="speech dtmf" timeout="5" speechTimeout="auto" action="${turnActionUrl}">
                    <Say voice="${aiVoice}" language="en-US">${escapeXml(greeting)}</Say>
                </Gather>
            </Response>
        `);
    } catch (error) {
        console.error('[AI Entry] Error initializing AI call:', error);
        // No generic softphone identity to fall back to here (each user's SIP
        // username is a per-account hash, not a fixed "user" address the way a
        // Twilio Client identity of 'user' used to be) — apologize and hang up
        // rather than dialing a target that can't resolve to anyone.
        return twimlResponse(`
            <Response>
                <Say voice="Polly.Joanna" language="en-US">Sorry, something went wrong connecting your call. Please try again.</Say>
                <Hangup/>
            </Response>
        `);
    }
}
