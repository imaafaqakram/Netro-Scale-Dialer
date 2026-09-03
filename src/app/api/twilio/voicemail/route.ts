import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getPublicAppUrl } from '@/lib/url'
import { syncCallToCrm } from '@/lib/crm/callSync'

// Transcription (Deepgram/Whisper) can take a while; give this route more headroom
// than the Next.js/Vercel default.
export const maxDuration = 60

function twimlResponse(twiml: string): NextResponse {
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    })
}

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

async function extractParams(request: NextRequest): Promise<Record<string, string>> {
    const params: Record<string, string> = {}
    request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value
    })

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
        console.error('[Voicemail Webhook] Param extraction error:', e)
    }

    return params
}

export async function POST(request: NextRequest) {
    try {
        const params = await extractParams(request)
        const userId = params['user_id'] || params['userId'] || ''
        const callerNumber = params['from'] || params['From'] || params['caller'] || ''
        const isSaveAction = params['action'] === 'save'
        const dialCallStatus = (params['DialCallStatus'] || '').toLowerCase()
        const recordingUrl = params['RecordingUrl'] || ''
        const recordingSid = params['RecordingSid'] || ''
        const recordingDuration = params['RecordingDuration'] || '0'
        const callSid = params['CallSid'] || ''

        console.log(`[Voicemail Webhook] userId: ${userId}, dialStatus: ${dialCallStatus}, action: ${isSaveAction ? 'save' : 'prompt'}, url: ${recordingUrl}`)

        // Scenario 2: Twilio is calling us back after recording was completed
        if (isSaveAction && recordingUrl) {
            return await saveVoicemail({
                userId,
                callerNumber,
                recordingUrl,
                recordingSid: recordingSid || '',
                callSid: callSid || '',
                duration: parseInt(recordingDuration || '0', 10),
            })
        }

        // Scenario 1: Dial action callback - check if we need to go to voicemail
        if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
            return twimlResponse(`<Response></Response>`)
        }

        const appUrl = await getPublicAppUrl(request)
        const supabase = createSupabaseAdmin()
        let greetingUrl: string | null = null

        if (userId && userId !== 'user') {
            const { data } = await supabase
                .from('user_phone_numbers')
                .select('voicemail_greeting_url')
                .eq('user_id', userId)
                .eq('voicemail_enabled', true)
                .limit(1)
                .single()

            greetingUrl = data?.voicemail_greeting_url || null
        }

        const greetingTwiml = greetingUrl
            ? `<Play>${greetingUrl}</Play>`
            : `<Say voice="Polly.Joanna">The person you are calling is unavailable. Please leave a message after the beep.</Say>`

        const recordActionUrl = `${appUrl}/api/twilio/voicemail?user_id=${encodeURIComponent(userId)}&amp;from=${encodeURIComponent(callerNumber)}&amp;action=save`

        return twimlResponse(`
            <Response>
                ${greetingTwiml}
                <Record
                    action="${recordActionUrl}"
                    maxLength="120"
                    playBeep="true"
                    transcribe="false"
                    timeout="10"
                />
                <Say voice="Polly.Joanna">No message was recorded. Goodbye.</Say>
            </Response>
        `)
    } catch (error) {
        console.error('[Voicemail] Error in handler:', error)
        return twimlResponse(`
            <Response>
                <Say>An error occurred with voicemail. Goodbye.</Say>
            </Response>
        `)
    }
}

interface SaveVoicemailParams {
    userId: string
    callerNumber: string
    recordingUrl: string
    recordingSid: string
    callSid: string
    duration: number
}

async function saveVoicemail(params: SaveVoicemailParams): Promise<NextResponse> {
    const supabase = createSupabaseAdmin()

    let targetUserId = params.userId
    if (!targetUserId || targetUserId === 'user') {
        const { data: anyNumber } = await supabase
            .from('user_phone_numbers')
            .select('user_id')
            .limit(1)
            .single()
        if (anyNumber?.user_id) targetUserId = anyNumber.user_id
    }

    if (!targetUserId) {
        console.warn('[Voicemail] No target user found to assign voicemail')
        return twimlResponse(`
            <Response>
                <Say voice="Polly.Joanna">Thank you. Your message has been received. Goodbye.</Say>
            </Response>
        `)
    }

    const { data: numberData } = await supabase
        .from('user_phone_numbers')
        .select('phone_number')
        .eq('user_id', targetUserId)
        .limit(1)
        .single()

    // Resolve org so org_admins get oversight visibility (see
    // supabase-migration-004-multi-tenant.sql).
    const { data: membership } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', targetUserId)
        .maybeSingle()

    const { error } = await supabase
        .from('call_recordings')
        .insert({
            user_id: targetUserId,
            org_id: membership?.org_id || null,
            phone_number: numberData?.phone_number || '',
            caller_number: params.callerNumber || 'Unknown Caller',
            recording_url: params.recordingUrl,
            recording_sid: params.recordingSid,
            call_sid: params.callSid,
            duration: params.duration,
            recording_type: 'voicemail',
            is_read: false,
        })

    if (error) {
        console.error('[Voicemail] Failed to save voicemail:', error)
    } else {
        console.log(`[Voicemail] Saved voicemail from ${params.callerNumber} for user ${targetUserId}`)
    }

    // Transcription can take a few seconds — the caller is live on the line waiting to
    // hear the goodbye message, so this must not block the TwiML response (unlike
    // recording-status, which is a pure background callback with nobody waiting).
    // next/server's after() runs this once the response has been sent, while keeping
    // the serverless function alive until it finishes — plain fire-and-forget after
    // `return` is not reliably given that guarantee on Vercel.
    after(() => syncCallToCrm({
        userId: targetUserId,
        phoneNumber: params.callerNumber || 'Unknown Caller',
        type: 'voicemail',
        direction: 'incoming',
        recordingUrl: params.recordingUrl,
    }))

    return twimlResponse(`
        <Response>
            <Say voice="Polly.Joanna">Thank you. Your message has been recorded. Goodbye.</Say>
        </Response>
    `)
}
