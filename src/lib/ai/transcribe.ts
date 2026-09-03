// Transcribes a completed Twilio call recording or voicemail. Deepgram is tried
// first when configured (fast, real free-trial credit, no infrastructure); a
// self-hosted Whisper-compatible endpoint is the fallback when Deepgram is
// unconfigured or fails — same "try the good option, degrade gracefully" pattern
// already used for the LLM chain in src/lib/ai/llm.ts.
//
// Both are optional/BYO-config via env vars:
//   DEEPGRAM_API_KEY     - Deepgram API key
//   WHISPER_ENDPOINT_URL - base URL of a self-hosted, OpenAI-compatible Whisper
//                          server exposing POST {url}/v1/audio/transcriptions
//                          (multipart form field "file", JSON response {text}).
//                          This is the most common shape for self-hosted Whisper
//                          servers (faster-whisper-server, LocalAI, whisper.cpp
//                          server); if yours differs, transcribeWithWhisper() below
//                          is the one place to adjust.
// If neither is set, transcribeRecording() returns null and callers must treat
// that as "no transcript available," not an error.

export interface TranscriptionResult {
    text: string;
    provider: 'deepgram' | 'whisper';
}

async function downloadTwilioRecording(recordingUrl: string): Promise<Buffer | null> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;

    if (!accountSid || !apiKey || !apiSecret) {
        console.error('[Transcribe] Twilio credentials not configured, cannot download recording');
        return null;
    }

    // Recording URLs from Twilio callbacks have no extension; .mp3 guarantees a
    // playable audio stream back instead of a metadata JSON response.
    const url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    try {
        const res = await fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
        if (!res.ok) {
            console.error(`[Transcribe] Failed to download recording: HTTP ${res.status}`);
            return null;
        }
        return Buffer.from(await res.arrayBuffer());
    } catch (e) {
        console.error('[Transcribe] Error downloading recording:', e);
        return null;
    }
}

async function transcribeWithDeepgram(audio: Buffer, apiKey: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);

        const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true', {
            method: 'POST',
            headers: {
                Authorization: `Token ${apiKey.trim()}`,
                'Content-Type': 'audio/mpeg',
            },
            body: audio,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`[Transcribe] Deepgram returned HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        return typeof transcript === 'string' ? transcript : null;
    } catch (e) {
        console.warn('[Transcribe] Deepgram error/timeout:', e);
        return null;
    }
}

async function transcribeWithWhisper(audio: Buffer, endpointUrl: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        const form = new FormData();
        form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'recording.mp3');
        form.append('model', 'whisper-1');

        const base = endpointUrl.replace(/\/+$/, '');
        const res = await fetch(`${base}/v1/audio/transcriptions`, {
            method: 'POST',
            body: form,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`[Transcribe] Whisper endpoint returned HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        return typeof data?.text === 'string' ? data.text : null;
    } catch (e) {
        console.warn('[Transcribe] Whisper endpoint error/timeout:', e);
        return null;
    }
}

export async function transcribeRecording(recordingUrl: string, customDeepgramKey?: string): Promise<TranscriptionResult | null> {
    const audio = await downloadTwilioRecording(recordingUrl);
    if (!audio) return null;

    const deepgramKey = customDeepgramKey || process.env.DEEPGRAM_API_KEY;
    if (deepgramKey) {
        const text = await transcribeWithDeepgram(audio, deepgramKey);
        if (text) return { text, provider: 'deepgram' };
    }

    const whisperUrl = process.env.WHISPER_ENDPOINT_URL;
    if (whisperUrl) {
        const text = await transcribeWithWhisper(audio, whisperUrl);
        if (text) return { text, provider: 'whisper' };
    }

    return null;
}
