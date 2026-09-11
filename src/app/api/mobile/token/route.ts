import { NextResponse } from 'next/server'
import { getUserFromBearer } from '@/lib/apiMobileAuth'
import { getOrCreateSipCredential } from '@/lib/signalwire/sipCredentials'
import { getSignalWireConfig } from '@/lib/signalwire/config'

// Mobile variant of /api/signalwire/sip-credentials. Authenticates with a
// Supabase Bearer token instead of cookies, then mints the same SIP credential.
export async function POST(request: Request) {
    try {
        const auth = await getUserFromBearer(request)
        if (!auth.user) {
            return NextResponse.json({ error: auth.message || 'Unauthorized' }, { status: auth.status })
        }

        // Same identity scheme as the web client: the Supabase user UUID.
        // Incoming calls route to this identity via <Sip>sip:{username}@domain</Sip>.
        const { username, password } = await getOrCreateSipCredential(auth.user.id)
        const { sipDomain } = getSignalWireConfig()

        return NextResponse.json({
            username,
            password,
            domain: sipDomain,
            wsUri: `wss://${sipDomain}`,
            identity: auth.user.id,
        })
    } catch (error) {
        console.error('[Mobile Token] Error:', error)
        return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }
}
