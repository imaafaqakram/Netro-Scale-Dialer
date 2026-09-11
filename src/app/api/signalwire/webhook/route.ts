import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getPublicAppUrl } from '@/lib/url'
import { getUserIdForSipUsername, sipUsernameFor } from '@/lib/signalwire/sipCredentials'
import { getSignalWireConfig } from '@/lib/signalwire/config'

// This route is set as BOTH the purchased number's inbound voice_url AND the SIP
// endpoint's call_request_url (see src/lib/signalwire/sipCredentials.ts), mirroring
// how a single Twilio TwiML App Voice URL used to cover both directions. It handles:
// 1. Incoming calls - routes through the AI agent & softphone with voicemail fallback
// 2. Outgoing calls - routes direct softphone calls, intro scripts, or AI calls with recording
// SignalWire sends form-encoded data via POST or query params via GET, same as Twilio.

function twimlResponse(twiml: string): NextResponse {
    console.log(`[SignalWire TwiML Response]\n${twiml}`)
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    })
}

// True when `From` is a SIP URI identifying one of our own registered browser
// softphones (e.g. "sip:u1a2b3c@netroscale-llc.sip.signalwire.com") rather than
// a real PSTN caller's E.164 number — replaces Twilio's "client:" prefix check.
function isFromOurSipEndpoint(from: string): boolean {
    return from.startsWith('sip:') || from.includes('@')
}

function sipUsernameFromUri(uri: string): string {
    const withoutScheme = uri.replace(/^sip:/, '')
    return withoutScheme.split('@')[0]
}

// Clean and ensure phone numbers are strictly in E.164 format (+1XXXXXXXXXX)
function formatE164(phone: string): string {
    if (!phone) return ''
    const clean = phone.split('#')[0].trim().replace(/[^0-9+]/g, '')
    if (!clean) return ''
    if (clean.startsWith('+')) return clean
    if (clean.length === 10) return `+1${clean}`
    if (clean.length === 11 && clean.startsWith('1')) return `+${clean}`
    return `+${clean}`
}

// Create a Supabase client without cookies (webhook requests come from SignalWire, not browser)
function createSupabaseAdmin() {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return [] },
                setAll() { /* no-op for webhooks */ },
            },
        }
    )
}

// Extract params from either POST form data or GET query params
async function extractParams(request: NextRequest): Promise<Record<string, string>> {
    const params: Record<string, string> = {}

    request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value
    })

    if (request.method === 'POST') {
        try {
            const contentType = request.headers.get('content-type') || ''
            if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                const formData = await request.formData()
                formData.forEach((value, key) => {
                    params[key] = value.toString()
                })
            } else if (contentType.includes('application/json')) {
                const json = await request.json()
                Object.entries(json).forEach(([k, v]) => {
                    if (v !== undefined && v !== null) params[k] = String(v)
                })
            } else {
                const rawText = await request.text()
                const searchParams = new URLSearchParams(rawText)
                searchParams.forEach((value, key) => {
                    params[key] = value
                })
            }
        } catch (e) {
            console.error('[SignalWire Webhook] Param extraction error:', e)
        }
    }

    return params
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
    try {
        const params = await extractParams(request)

        console.log('[SignalWire Webhook] Received params:', JSON.stringify(params))

        const from = params['From'] || ''
        const direction = params['Direction'] || ''
        const callSid = params['CallSid'] || ''

        console.log(`[SignalWire Webhook] Raw params: From=${from}, Direction=${direction}, To=${params['To']}, CallSid=${callSid}`)

        // ─── Determine call direction ─────────────────────────────────────────
        // OUTGOING: From is a SIP URI identifying one of our own registered SIP
        //           endpoints (our browser softphones always dial as one). Also
        //           treat explicit outbound-api direction as outgoing.
        const isOutgoing = isFromOurSipEndpoint(from) || direction === 'outbound-api'

        if (isOutgoing) {
            // Our SIP endpoints always dial the real destination directly as the
            // Request-URI (see makeCall() in useSignalWireDevice.ts), so `To` is
            // already the actual number — no more parameter-guessing needed here.
            const to = params['To'] || ''
            console.log(`[SignalWire Webhook] OUTGOING → to=${to}, from=${from}`)
            return await handleOutgoingCall(to, from, params, request)
        }

        // INCOMING: real phone call hitting our SignalWire number.
        const to = params['To'] || params['Called'] || params['called'] || ''
        console.log(`[SignalWire Webhook] INCOMING → to=${to}, from=${from}, direction=${direction}`)
        return await handleIncomingCall(to, from, request)
    } catch (error) {
        console.error('[SignalWire Webhook] Error:', error)
        return twimlResponse(`
            <Response>
                <Say>An error occurred. Please check server logs.</Say>
            </Response>
        `)
    }
}

export async function POST(request: NextRequest) {
    return handleRequest(request)
}

export async function GET(request: NextRequest) {
    return handleRequest(request)
}

async function handleOutgoingCall(to: string, from: string, params: Record<string, string>, request: NextRequest): Promise<NextResponse> {
    const sipUsername = isFromOurSipEndpoint(from) ? sipUsernameFromUri(from) : ''
    const userId = sipUsername ? (await getUserIdForSipUsername(sipUsername)) || '' : ''
    const appUrl = await getPublicAppUrl(request)
    // Custom SIP header set by the browser (X-Call-Mode) if SignalWire forwards
    // it through to this webhook's params; falls back to 'direct' (this app's
    // most common case) if not, rather than depending on that being confirmed.
    const callMode = (params['X-Call-Mode'] || params['callMode'] || params['mode'] || 'direct').toLowerCase()

    // 0. Special: In-Browser AI Test Call (*99 or 'test')
    if (to === '*99' || to === '99' || to.toLowerCase() === 'test' || callMode === 'test') {
        console.log(`[SignalWire Webhook] In-Browser AI Voice Test Call connected for user ${userId}`)
        const greeting = `Hello! This is your Netro Scale AI voice agent test line. I am running live with your saved script and knowledge base. Go ahead and ask me a question.`
        const turnActionUrl = `${appUrl}/api/signalwire/ai-call/turn?agentUserId=${encodeURIComponent(userId || 'user')}&amp;callerId=%2B13072076444&amp;turnCount=1`

        return twimlResponse(`
            <Response>
                <Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${turnActionUrl}">
                    <Say voice="Polly.Joanna" language="en-US">${greeting}</Say>
                </Gather>
            </Response>
        `)
    }

    if (!to) {
        console.error('[SignalWire Webhook] No valid destination number in params:', params)
        return twimlResponse(`
            <Response>
                <Say>No destination number was provided. Please check the dialed number and try again.</Say>
            </Response>
        `)
    }

    const cleanTo = formatE164(to)

    // 1. Check if callerId was explicitly sent (X-Caller-Id header, or a param)
    let callerId = ''
    const paramCallerId = (params['X-Caller-Id'] || params['callerId'] || params['CallerId'] || params['fromNumber'] || params['FromNumber'] || '').trim()
    if (paramCallerId && paramCallerId.replace(/[^0-9]/g, '').length >= 7) {
        callerId = paramCallerId
    }

    // 2. Look up the caller's default number and recording settings from Supabase
    let recordingEnabled = true // Enable call recording by default
    if (userId) {
        try {
            const supabase = createSupabaseAdmin()
            const { data: defaultData } = await supabase
                .from('user_phone_numbers')
                .select('phone_number, call_recording_enabled')
                .eq('user_id', userId)
                .eq('is_default', true)
                .limit(1)
                .single()

            if (defaultData?.phone_number && !callerId) {
                callerId = defaultData.phone_number
            }
            if (defaultData && defaultData.call_recording_enabled !== undefined) {
                recordingEnabled = !!defaultData.call_recording_enabled
            }
        } catch (e) {
            console.error('[SignalWire Webhook] Error fetching callerId/settings from Supabase:', e)
        }
    }

    // 3. Fallback to default number
    if (!callerId) {
        callerId = process.env.SIGNALWIRE_DEFAULT_NUMBER || '+13072076444'
    }

    callerId = formatE164(callerId) || '+13072076444'

    const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : ''
    const recordCallbackAttr = recordingEnabled
        ? ` recordingStatusCallback="${appUrl}/api/signalwire/recording-status?user_id=${encodeURIComponent(userId || 'user')}" recordingStatusCallbackEvent="completed"`
        : ''

    // Per-leg call lifecycle callback -> permanent call_history row (see
    // src/app/api/signalwire/call-status/route.ts). Attached to <Number> itself (not
    // <Dial>) so it reports this specific PSTN leg's CallSid/CallStatus/CallDuration —
    // that leg is the source of truth for what actually happened on this call.
    const statusCallbackUrlFor = (mode: 'direct' | 'script' | 'ai_agent') =>
        `${appUrl}/api/signalwire/call-status?user_id=${encodeURIComponent(userId || 'user')}&amp;direction=outgoing&amp;call_mode=${mode}`
    const statusCallbackAttrFor = (mode: 'direct' | 'script' | 'ai_agent') =>
        ` statusCallback="${statusCallbackUrlFor(mode)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed"`

    console.log(`[SignalWire Webhook] Outgoing call to ${cleanTo} with mode=${callMode}, callerId=${callerId}, recording=${recordingEnabled}`)

    // Mode 1: AI Agent
    if (callMode === 'ai_agent') {
        const aiUrl = `${appUrl}/api/signalwire/ai-call?agentUserId=${encodeURIComponent(userId || 'user')}&amp;callerId=${encodeURIComponent(callerId)}`
        return twimlResponse(`
            <Response>
                <Dial answerOnBridge="true" callerId="${callerId}"${recordAttr}${recordCallbackAttr}>
                    <Number url="${aiUrl}"${statusCallbackAttrFor('ai_agent')}>${cleanTo}</Number>
                </Dial>
            </Response>
        `)
    }

    // Mode 2: Script Intro + Auto-Transfer
    if (callMode === 'script') {
        const scriptUrl = `${appUrl}/api/signalwire/ai-call/script-intro`
        return twimlResponse(`
            <Response>
                <Dial answerOnBridge="true" callerId="${callerId}"${recordAttr}${recordCallbackAttr}>
                    <Number url="${scriptUrl}"${statusCallbackAttrFor('script')}>${cleanTo}</Number>
                </Dial>
            </Response>
        `)
    }

    // Mode 3: Direct Softphone Call (Default)
    return twimlResponse(`
        <Response>
            <Dial answerOnBridge="true" callerId="${callerId}"${recordAttr}${recordCallbackAttr}>
                <Number${statusCallbackAttrFor('direct')}>${cleanTo}</Number>
            </Dial>
        </Response>
    `)
}

async function handleIncomingCall(to: string, from: string, request: NextRequest): Promise<NextResponse> {
    const supabase = createSupabaseAdmin()
    const dialedNumber = to || ''

    type NumberRecord = { user_id: string; call_recording_enabled?: boolean; voicemail_enabled?: boolean; voicemail_greeting_url?: string | null }
    let numberRecord: NumberRecord | null = null

    // Wrapped in try/catch: a transient Supabase/network error here must NOT collapse
    // into "no one is available" and hang up on a live inbound caller. It should degrade
    // to the same best-effort fallback used when the number simply isn't mapped yet.
    try {
        const exactResult = await supabase
            .from('user_phone_numbers')
            .select('user_id, call_recording_enabled, voicemail_enabled, voicemail_greeting_url')
            .eq('phone_number', dialedNumber)
            .limit(1)
            .single()

        if (!exactResult.error && exactResult.data) {
            numberRecord = exactResult.data
        } else {
            const normalizedNumber = formatE164(dialedNumber)
            if (normalizedNumber && normalizedNumber !== dialedNumber) {
                const normalizedResult = await supabase
                    .from('user_phone_numbers')
                    .select('user_id, call_recording_enabled, voicemail_enabled, voicemail_greeting_url')
                    .eq('phone_number', normalizedNumber)
                    .limit(1)
                    .single()
                if (!normalizedResult.error && normalizedResult.data) {
                    numberRecord = normalizedResult.data
                }
            }
        }
    } catch (e) {
        console.error(`[SignalWire Webhook] Number lookup for ${dialedNumber} threw (transient DB/network error):`, e)
    }

    let userId: string | null = numberRecord?.user_id || null
    let usedFallbackUser = false

    if (!userId) {
        // No exact/normalized mapping for this specific number (or the lookup above
        // errored) — best-effort: ring whichever user is configured rather than
        // dead-ending a live call. NOTE: this is only correct for a single-tenant
        // deployment where "any row" and "the right owner" are the same thing. Once
        // numbers can belong to different tenants, this fallback must be scoped to the
        // tenant that owns `dialedNumber` — ringing a global "first row" account would
        // route one tenant's inbound calls to a different tenant's agent.
        try {
            const { data: anyNumber } = await supabase
                .from('user_phone_numbers')
                .select('user_id')
                .limit(1)
                .single()
            if (anyNumber?.user_id) {
                userId = anyNumber.user_id
                usedFallbackUser = true
            }
        } catch (e) {
            console.error('[SignalWire Webhook] Fallback "any configured user" lookup also failed:', e)
        }
    }

    const agentUserId = userId || 'user'
    const appUrl = await getPublicAppUrl(request)

    // Caller ID shown on the softphone = the person actually calling in.
    const inboundCallerId = formatE164(from) || from || to || process.env.SIGNALWIRE_DEFAULT_NUMBER || '+13072076444'

    if (!userId) {
        // Nobody is configured in the system at all — not a transient hiccup, there is
        // truly no one to ring and no voicemail box to record into (voicemail is keyed
        // by user_id).
        console.warn(`[SignalWire Webhook] Incoming call to ${to} but no user is configured in user_phone_numbers at all`)
        return twimlResponse(`
            <Response>
                <Say voice="Polly.Joanna">Thank you for calling. No one is available to take your call right now. Please try again later.</Say>
                <Hangup/>
            </Response>
        `)
    }

    if (usedFallbackUser) {
        console.warn(`[SignalWire Webhook] Incoming call to ${to} has no matching number mapping — falling back to user ${userId}. Add ${to} to user_phone_numbers to fix this.`)
    }

    console.log(`[SignalWire Webhook] Incoming call from ${from} → ringing softphone for user ${agentUserId}`)

    // Record the call if the number has recording enabled (default on).
    const recordingEnabled = numberRecord ? !!numberRecord.call_recording_enabled : true
    const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : ''
    const recordCallbackAttr = recordingEnabled
        ? ` recordingStatusCallback="${appUrl}/api/signalwire/recording-status?user_id=${encodeURIComponent(agentUserId)}" recordingStatusCallbackEvent="completed"`
        : ''

    // Voicemail fallback if the softphone does not answer within the timeout.
    const voicemailEnabled = numberRecord ? !!numberRecord.voicemail_enabled : true
    const actionAttr = voicemailEnabled
        ? ` action="${appUrl}/api/signalwire/voicemail?user_id=${encodeURIComponent(agentUserId)}&amp;from=${encodeURIComponent(from || '')}"`
        : ''

    // Per-leg call lifecycle callback -> permanent call_history row. From/To on this
    // leg's callback are the callerId we set above (the real inbound caller) and the
    // SIP identity, so "From" is correctly the customer's number, not our own.
    const statusCallbackAttr = ` statusCallback="${appUrl}/api/signalwire/call-status?user_id=${encodeURIComponent(agentUserId)}&amp;direction=incoming&amp;call_mode=direct" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed"`

    const { sipDomain } = getSignalWireConfig()
    const sipTarget = `sip:${sipUsernameFor(agentUserId)}@${sipDomain}`

    return twimlResponse(`
        <Response>
            <Dial answerOnBridge="true" callerId="${inboundCallerId}"${recordAttr}${recordCallbackAttr}${actionAttr} timeout="25">
                <Sip${statusCallbackAttr}>${sipTarget}</Sip>
            </Dial>
        </Response>
    `)
}
