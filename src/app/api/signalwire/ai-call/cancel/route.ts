import { NextRequest, NextResponse } from 'next/server';
import { getSignalWireClient } from '@/lib/signalwire/restClient';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const callSid = body.callSid || '';

        if (!callSid) {
            return NextResponse.json({ error: 'callSid is required' }, { status: 400 });
        }

        const client = getSignalWireClient();
        await client.calls(callSid).update({ status: 'completed' });

        console.log(`[Campaign Cancel] Terminated call ${callSid}`);
        return NextResponse.json({ success: true, callSid });
    } catch (error: any) {
        console.error('[Campaign Cancel] Error:', error);
        return NextResponse.json({
            error: error.message || 'Failed to cancel call',
        }, { status: 500 });
    }
}
