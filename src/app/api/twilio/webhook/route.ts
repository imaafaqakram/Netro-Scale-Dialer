import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getPublicAppUrl } from '@/lib/url'

// This route handles:
// 1. Incoming calls - routes through the AI agent & softphone with voicemail fallback
// 2. Outgoing calls - routes direct softphone calls, intro scripts, or AI calls with recording
// Twilio sends form-encoded data via POST or query params via GET.

function twimlResponse(twiml: string): NextResponse {
    console.log(`[Twilio TwiML Response]\n${twiml}`)
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    })
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

// Create a Supabase client without cookies (webhook requests come from Twilio, not browser)
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
            console.error('[Twilio Webhook] Param extraction error:', e)
        }
    }

    return params
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
    try {
        const params = await extractParams(request)

        console.log('[Twilio Webhook] Received params:', JSON.stringify(params))

        const from = params['From'] || ''
        const direction = params['Direction'] || ''
        const callSid = params['CallSid'] || ''

        console.log(`[Twilio Webhook] Raw params: From=${from}, Direction=${direction}, To=${params['To']}, CallSid=${callSid}`)

        // ─── Determine call direction ─────────────────────────────────────────
        // OUTGOING: From starts with "client:" — browser SDK always sets this.
        //           Also treat explicit outbound-api direction as outgoing.
        const isOutgoing = from.startsWith('client:') || direction === 'outbound-api'

        if (isOutgoing) {
            let to = params['ToNumber'] ||
                     params['phoneNumber'] ||
                     params['PhoneNumber'] ||
                     params['called'] ||
                     params['Called'] ||
                     params['destination'] ||
                     params['number'] ||
                     params['phone_number'] ||
                     ''

            if (!to || to.startsWith('AP') || to.startsWith('client:')) {
                const twilioTo = params['To'] || ''
                if (twilioTo && !twilioTo.startsWith('AP') && !twilioTo.startsWith('client:')) {
                    to = twilioTo
                }
            }

            if (!to || to.startsWith('AP') || to.startsWith('client:')) {
                const digitParam = Object.entries(params).find(([k, v]) =>
                    k !== 'From' &&
                    k !== 'CallSid' &&
                    !v.startsWith('AP') &&
                    !v.startsWith('client:') &&
                    !v.startsWith('CA') &&
                    !v.startsWith('AC') &&
                    !v.startsWith('SK') &&
                    v.replace(/[^0-9]/g, '').length >= 7
                )
                if (digitParam) to = digitParam[1]
            }

            console.log(`[Twilio Webhook] OUTGOING → to=${to}, from=${from}`)
            return await handleOutgoingCall(to, from, params, request)
        }

        // INCOMING: real phone call hitting our Twilio number.
        const to = params['To'] || params['Called'] || params['called'] || ''
        console.log(`[Twilio Webhook] INCOMING → to=${to}, from=${from}, direction=${direction}`)
        return await handleIncomingCall(to, from, request)
    } catch (error) {
        console.error('[Twilio Webhook] Error:', error)
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
    const userId = from.startsWith('client:') ? from.replace('client:', '') : ''
    const appUrl = await getPublicAppUrl(request)
    const callMode = (params['callMode'] || params['mode'] || 'direct').toLowerCase()

    // 0. Special: In-Browser AI Test Call (*99 or 'test')
    if (to === '*99' || to === '99' || to.toLowerCase() === 'test' || callMode === 'test') {
        console.log(`[Twilio Webhook] In-Browser AI Voice Test Call connected for user ${userId}`)
        const greeting = `Hello! This is your Netro Scale AI voice agent test line. I am running live with your saved script and knowledge base. Go ahead and ask me a question.`
        const turnActionUrl = `${appUrl}/api/twilio/ai-call/turn?agentUserId=${encodeURIComponent(userId || 'user')}&amp;callerId=%2B13072076444&amp;turnCount=1`

        return twimlResponse(`
            <Response>
                <Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${turnActionUrl}">
                    <Say voice="Polly.Joanna" language="en-US">${greeting}</Say>
                </Gather>
            </Response>
        `)
    }

    if (!to || to.startsWith('AP') || to.startsWith('client:')) {
        console.error('[Twilio Webhook] No valid destination number in params:', params)
        return twimlResponse(`
            <Response>
                <Say>No destination number was provided. Please check the dialed number and try again.</Say>
            </Response>
        `)
    }

    const cleanTo = formatE164(to)

    // 1. Check if callerId was explicitly sent in params
    let callerId = ''
    const paramCallerId = (params['callerId'] || params['CallerId'] || params['fromNumber'] || params['FromNumber'] || '').trim()
    if (paramCallerId && !paramCallerId.startsWith('client:') && paramCallerId.replace(/[^0-9]/g, '').length >= 7) {
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
            console.error('[Twilio Webhook] Error fetching callerId/settings from Supabase:', e)
        }
    }

    // 3. Fallback to default number
    if (!callerId) {
        callerId = process.env.TWILIO_DEFAULT_NUMBER || 
                   process.env.TWILIO_PHONE_NUMBER || 
                   process.env.TWILIO_CALLER_ID || 
                   '+13072076444'
    }

    callerId = formatE164(callerId) || '+13072076444'

    const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : ''
    const recordCallbackAttr = recordingEnabled
        ? ` recordingStatusCallback="${appUrl}/api/twilio/recording-status?user_id=${encodeURIComponent(userId || 'user')}" recordingStatusCallbackEvent="completed"`
        : ''

    // Per-leg call lifecycle callback -> permanent call_history row (see
    // src/app/api/twilio/call-status/route.ts). Attached to <Number> itself (not
    // <Dial>) so it reports this specific PSTN leg's CallSid/CallStatus/CallDuration —
    // that leg is the source of truth for what actually happened on this call.
    const statusCallbackUrlFor = (mode: 'direct' | 'script' | 'ai_agent') =>
        `${appUrl}/api/twilio/call-status?user_id=${encodeURIComponent(userId || 'user')}&amp;direction=outgoing&amp;call_mode=${mode}`
    const statusCallbackAttrFor = (mode: 'direct' | 'script' | 'ai_agent') =>
        ` statusCallback="${statusCallbackUrlFor(mode)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed"`

    console.log(`[Twilio Webhook] Outgoing call to ${cleanTo} with mode=${callMode}, callerId=${callerId}, recording=${recordingEnabled}`)

    // Mode 1: AI Agent
    if (callMode === 'ai_agent') {
        const aiUrl = `${appUrl}/api/twilio/ai-call?agentUserId=${encodeURIComponent(userId || 'user')}&amp;callerId=${encodeURIComponent(callerId)}`
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
        const scriptUrl = `${appUrl}/api/twilio/ai-call/script-intro`
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
        console.error(`[Twilio Webhook] Number lookup for ${dialedNumber} threw (transient DB/network error):`, e)
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
            console.error('[Twilio Webhook] Fallback "any configured user" lookup also failed:', e)
        }
    }

    const agentUserId = userId || 'user'
    const appUrl = await getPublicAppUrl(request)

    // Caller ID shown on the softphone = the person actually calling in.
    const inboundCallerId = formatE164(from) || from || to || process.env.TWILIO_DEFAULT_NUMBER || '+13072076444'

    if (!userId) {
        // Nobody is configured in the system at all — not a transient hiccup, there is
        // truly no one to ring and no voicemail box to record into (voicemail is keyed
        // by user_id).
        console.warn(`[Twilio Webhook] Incoming call to ${to} but no user is configured in user_phone_numbers at all`)
        return twimlResponse(`
            <Response>
                <Say voice="Polly.Joanna">Thank you for calling. No one is available to take your call right now. Please try again later.</Say>
                <Hangup/>
            </Response>
        `)
    }

    if (usedFallbackUser) {
        console.warn(`[Twilio Webhook] Incoming call to ${to} has no matching number mapping — falling back to user ${userId}. Add ${to} to user_phone_numbers to fix this.`)
    }

    console.log(`[Twilio Webhook] Incoming call from ${from} → ringing softphone for user ${agentUserId}`)

    // Record the call if the number has recording enabled (default on).
    const recordingEnabled = numberRecord ? !!numberRecord.call_recording_enabled : true
    const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : ''
    const recordCallbackAttr = recordingEnabled
        ? ` recordingStatusCallback="${appUrl}/api/twilio/recording-status?user_id=${encodeURIComponent(agentUserId)}" recordingStatusCallbackEvent="completed"`
        : ''

    // Voicemail fallback if the softphone does not answer within the timeout.
    const voicemailEnabled = numberRecord ? !!numberRecord.voicemail_enabled : true
    const actionAttr = voicemailEnabled
        ? ` action="${appUrl}/api/twilio/voicemail?user_id=${encodeURIComponent(agentUserId)}&amp;from=${encodeURIComponent(from || '')}"`
        : ''

    // Per-leg call lifecycle callback -> permanent call_history row. From/To on this
    // leg's callback are the callerId we set above (the real inbound caller) and the
    // Client identity, so "From" is correctly the customer's number, not our own.
    const statusCallbackAttr = ` statusCallback="${appUrl}/api/twilio/call-status?user_id=${encodeURIComponent(agentUserId)}&amp;direction=incoming&amp;call_mode=direct" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed"`

    return twimlResponse(`
        <Response>
            <Dial answerOnBridge="true" callerId="${inboundCallerId}"${recordAttr}${recordCallbackAttr}${actionAttr} timeout="25">
                <Client${statusCallbackAttr}>${escapeXml(agentUserId)}</Client>
            </Dial>
        </Response>
    `)
}

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
