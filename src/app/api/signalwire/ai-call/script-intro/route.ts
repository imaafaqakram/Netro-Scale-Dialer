import { NextRequest, NextResponse } from 'next/server';

function twimlResponse(twiml: string): NextResponse {
    return new NextResponse(twiml, {
        headers: { 'Content-Type': 'text/xml' },
    });
}

export async function POST(request: NextRequest) {
    return handleScript(request);
}

export async function GET(request: NextRequest) {
    return handleScript(request);
}

async function handleScript(request: NextRequest): Promise<NextResponse> {
    const script = `Hello, and thanks for taking our call from Netro Scale. Please hold for a moment while I connect you with a member of our team.`;
    return twimlResponse(`
        <Response>
            <Say voice="Polly.Joanna" language="en-US">${script}</Say>
        </Response>
    `);
}
