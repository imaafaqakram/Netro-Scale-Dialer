import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { signalWireBasicAuth } from '@/lib/signalwire/config'

// Proxy SignalWire recording audio to the browser.
// SignalWire recordings require HTTP Basic Auth (Project ID + API Token).

export async function GET(request: NextRequest) {
    try {
        // Verify user is authenticated
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll() },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    },
                },
            }
        )

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const recordingUrl = url.searchParams.get('url')

        if (!recordingUrl) {
            return NextResponse.json({ error: 'Recording URL required' }, { status: 400 })
        }

        // Ensure we request .mp3 format
        const audioUrl = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`

        const response = await fetch(audioUrl, {
            headers: {
                'Authorization': `Basic ${signalWireBasicAuth()}`,
            },
        })

        if (!response.ok) {
            console.error(`[Audio Proxy] Failed to fetch recording: ${response.status}`)
            return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 502 })
        }

        const audioData = await response.arrayBuffer()
        return new NextResponse(audioData, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioData.byteLength.toString(),
                'Cache-Control': 'private, max-age=3600',
            },
        })
    } catch (error) {
        console.error('[Audio Proxy] Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
