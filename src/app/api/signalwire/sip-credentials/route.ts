import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateSipCredential } from '@/lib/signalwire/sipCredentials'
import { getSignalWireConfig } from '@/lib/signalwire/config'

// Replaces the old Twilio AccessToken/VoiceGrant JWT with a SIP username/password
// pair the browser registers with directly over WebSocket (see
// src/hooks/useSignalWireDevice.ts). Same identity scheme as before — routing
// still keys off the Supabase user id — just a different auth shape underneath.
export async function POST() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { username, password } = await getOrCreateSipCredential(user.id)
        const { sipDomain } = getSignalWireConfig()

        return NextResponse.json({
            username,
            password,
            domain: sipDomain,
            wsUri: `wss://${sipDomain}`,
            identity: user.id,
        })
    } catch (error) {
        console.error('[SIP Credentials] Error:', error)
        // Surfaced to the (already-authenticated) caller temporarily while bringing
        // the SignalWire migration up — narrow this back to a generic message once
        // provisioning is confirmed working end-to-end.
        const detail = error instanceof Error ? error.message : String(error)
        return NextResponse.json({ error: 'Failed to provision SIP credentials', detail }, { status: 500 })
    }
}
