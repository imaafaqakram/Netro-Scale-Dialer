import { NextRequest, NextResponse } from 'next/server'
import { getUserFromBearer } from '@/lib/apiMobileAuth'
import { signalWireBasicAuth, getSignalWireConfig } from '@/lib/signalwire/config'

// Streams a SignalWire recording to the mobile app. Expo-Audio cannot attach HTTP
// basic-auth headers, so the app plays from this proxy URL with its bearer
// token instead of hitting SignalWire directly.

export async function GET(request: NextRequest) {
    try {
        const auth = await getUserFromBearer(request)
        if (!auth.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status })
        }

        const url = new URL(request.url)
        const recordingUrl = url.searchParams.get('url')

        if (!recordingUrl) {
            return NextResponse.json({ error: 'Recording URL required' }, { status: 400 })
        }

        // Only allow proxying our own SignalWire space's recording host
        const { space } = getSignalWireConfig()
        const parsed = new URL(recordingUrl)
        if (parsed.hostname !== space) {
            return NextResponse.json({ error: 'Unsupported recording host' }, { status: 400 })
        }

        const audioUrl = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`

        const response = await fetch(audioUrl, {
            headers: { Authorization: `Basic ${signalWireBasicAuth()}` },
        })

        if (!response.ok) {
            console.error(`[Mobile Audio Proxy] Failed to fetch recording: ${response.status}`)
            return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 502 })
        }

        const audioData = await response.arrayBuffer()
        return new NextResponse(audioData, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioData.byteLength.toString(),
                'Cache-Control': 'private, max-age=3600',
                'Accept-Ranges': 'bytes',
            },
        })
    } catch (error) {
        console.error('[Mobile Audio Proxy] Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
