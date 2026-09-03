import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncCallToCrm } from '@/lib/crm/callSync'

// Transcription (Deepgram/Whisper) can take a while on longer calls; give this route
// more headroom than the Next.js/Vercel default before Twilio's own retry kicks in.
export const maxDuration = 60

// Twilio calls this when a call recording is completed.
// We save the recording metadata to Supabase.

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
        console.error('[Recording Status] Param extraction error:', e)
    }

    return params
}

export async function POST(request: NextRequest) {
    try {
        const params = await extractParams(request)
        const userId = params['user_id'] || params['userId'] || ''
        const recordingUrl = params['RecordingUrl'] || ''
        const recordingSid = params['RecordingSid'] || ''
        const recordingDuration = params['RecordingDuration'] || '0'
        const callSid = params['CallSid'] || ''
        const recordingStatus = (params['RecordingStatus'] || '').toLowerCase()
        const from = params['From'] || ''
        const to = params['To'] || ''

        console.log(`[Recording Status Webhook] userId: ${userId}, status: ${recordingStatus}, sid: ${recordingSid}, duration: ${recordingDuration}s, url: ${recordingUrl}`)

        if (!recordingUrl || (recordingStatus && recordingStatus !== 'completed')) {
            return NextResponse.json({ ok: true })
        }

        const supabase = createSupabaseAdmin()

        // Resolve userId if not passed in query params
        let targetUserId = userId
        if (!targetUserId || targetUserId === 'user') {
            const { data: anyNumber } = await supabase
                .from('user_phone_numbers')
                .select('user_id')
                .limit(1)
                .single()
            if (anyNumber?.user_id) targetUserId = anyNumber.user_id
        }

        if (!targetUserId) {
            console.warn('[Recording Status] No userId found, cannot save recording')
            return NextResponse.json({ ok: true })
        }

        // Look up the user's phone number for context
        const { data: numberData } = await supabase
            .from('user_phone_numbers')
            .select('phone_number')
            .eq('user_id', targetUserId)
            .limit(1)
            .single()

        // Check if this recording already exists in DB
        const { data: existing } = await supabase
            .from('call_recordings')
            .select('id')
            .eq('recording_sid', recordingSid)
            .limit(1)
            .single()

        if (existing) {
            console.log(`[Recording Status] Recording ${recordingSid} already exists in DB`)
            return NextResponse.json({ ok: true })
        }

        const callerNumber = from || to || numberData?.phone_number || ''

        const { error } = await supabase
            .from('call_recordings')
            .insert({
                user_id: targetUserId,
                phone_number: numberData?.phone_number || to || '',
                caller_number: callerNumber,
                recording_url: recordingUrl,
                recording_sid: recordingSid || '',
                call_sid: callSid || '',
                duration: parseInt(recordingDuration || '0', 10),
                recording_type: 'call',
                is_read: false,
            })

        if (error) {
            console.error('[Recording Status] Failed to save recording to DB:', error)
        } else {
            console.log(`[Recording Status] Successfully saved call recording ${recordingSid} for user ${targetUserId}`)
        }

        // Best-effort: transcribe + sync to the user's CRM sheet, if they've configured
        // one (see src/lib/crm/callSync.ts — no-ops cleanly if not). Awaited rather than
        // fire-and-forget: this is a serverless function, and a "background" task started
        // after the response is sent is not guaranteed to finish once the response goes
        // out. Recording-status is already an async, post-call callback, so the extra
        // latency here doesn't affect call quality.
        const businessNumber = numberData?.phone_number || ''
        const isOutgoing = !!businessNumber && from === businessNumber
        await syncCallToCrm({
            userId: targetUserId,
            phoneNumber: (isOutgoing ? to : from) || callerNumber,
            type: 'call',
            direction: isOutgoing ? 'outgoing' : 'incoming',
            recordingUrl,
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[Recording Status] Error handling callback:', error)
        return NextResponse.json({ ok: true })
    }
}
