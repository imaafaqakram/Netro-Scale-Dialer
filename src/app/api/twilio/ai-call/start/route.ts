import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createClient } from '@/lib/supabase/server';
import { getPublicAppUrl } from '@/lib/url';
import { registerCall } from '@/lib/ai/callStore';

function formatE164(phone: string): string {
    const clean = phone.replace(/[^0-9+]/g, '');
    if (!clean) return '';
    if (clean.startsWith('+')) return clean;
    if (clean.length === 10) return `+1${clean}`;
    if (clean.length === 11 && clean.startsWith('1')) return `+${clean}`;
    return `+${clean}`;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const to = body.to || body.phoneNumber || '';
        const requestedCallerId = body.callerId || process.env.TWILIO_DEFAULT_NUMBER || '+13072076444';
        const leadName = (body.leadName || body.name || '').toString().trim();
        const leadEmail = (body.leadEmail || body.email || '').toString().trim();
        const leadId = body.leadId || '';

        if (!to) {
            return NextResponse.json({ error: 'Destination phone number is required' }, { status: 400 });
        }

        const cleanTo = formatE164(to);
        const cleanCallerId = formatE164(requestedCallerId);

        // agentUserId: prefer what the frontend sends (it's the Twilio client identity = Supabase user.id)
        let userId = body.agentUserId || '';
        if (!userId) {
            try {
                const supabase = await createClient();
                const { data: { user } } = await supabase.auth.getUser();
                if (user) userId = user.id;
            } catch {}
        }
        if (!userId) userId = 'user';

        console.log(`[AI Call Start] agentUserId resolved to: ${userId}`);

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const apiKey = process.env.TWILIO_API_KEY;
        const apiSecret = process.env.TWILIO_API_SECRET;

        if (!accountSid || !apiKey || !apiSecret) {
            return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 });
        }

        const client = twilio(apiKey, apiSecret, { accountSid });
        const appUrl = await getPublicAppUrl(request);

        const aiWebhookUrl = `${appUrl}/api/twilio/ai-call?agentUserId=${encodeURIComponent(userId)}&callerId=${encodeURIComponent(cleanCallerId)}&leadName=${encodeURIComponent(leadName)}&leadId=${encodeURIComponent(leadId)}`;

        console.log(`[AI Call Start] Dialing customer ${cleanTo} from ${cleanCallerId} with webhook: ${aiWebhookUrl}`);

        const call = await client.calls.create({
            to: cleanTo,
            from: cleanCallerId,
            url: aiWebhookUrl,
            machineDetection: 'Enable',
            machineDetectionTimeout: 20,
            asyncAmd: 'true',
            asyncAmdStatusCallback: `${appUrl}/api/twilio/ai-call/status?agentUserId=${encodeURIComponent(userId)}&type=amd`,
            statusCallback: `${appUrl}/api/twilio/ai-call/status?agentUserId=${encodeURIComponent(userId)}&leadName=${encodeURIComponent(leadName)}&leadId=${encodeURIComponent(leadId)}`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        });

        // Register in live telemetry store
        registerCall({
            callSid: call.sid,
            agentUserId: userId,
            to: cleanTo,
            from: cleanCallerId,
            leadName,
            leadEmail,
            leadId,
        });

        return NextResponse.json({
            success: true,
            callSid: call.sid,
            status: call.status,
            to: cleanTo,
            leadName,
            message: `AI Voice Agent is dialing ${cleanTo}.`,
        });
    } catch (error: any) {
        console.error('[AI Call Start] Error initiating AI call:', error);
        return NextResponse.json({
            error: error.message || 'Failed to initiate AI call',
        }, { status: 500 });
    }
}
