// Adapts a JsSIP RTCSession to the same shape the app already speaks throughout
// useCallState.ts / AppLayout.tsx / page.tsx / recordings/page.tsx (modeled on
// @twilio/voice-sdk's Call: .on/.off, .parameters, .accept/.reject/.disconnect,
// .mute(bool), .sendDigits(digit)). Keeping this shape identical is what let the
// SignalWire migration touch only the device/hook layer instead of rewriting
// every consumer of the call-state context.

// Minimal structural type for what we actually use off a JsSIP RTCSession —
// avoids depending on jssip's internal type-export paths, which vary by version.
export interface JsSipRTCSessionLike {
    direction: 'incoming' | 'outgoing';
    remote_identity?: { uri?: { user?: string } };
    request?: { getHeader?: (name: string) => string | undefined };
    on(event: string, cb: (data?: any) => void): void;
    terminate(options?: any): void;
    answer(options?: any): void;
    mute(options?: { audio?: boolean; video?: boolean }): void;
    unmute(options?: { audio?: boolean; video?: boolean }): void;
    sendDTMF(tone: string, options?: any): void;
}

type CallEvent = 'ringing' | 'accept' | 'disconnect' | 'cancel' | 'error';
type Listener = (...args: any[]) => void;

export class SignalWireCall {
    readonly parameters: { From?: string; To?: string };
    readonly customParameters: Map<string, string>;
    readonly direction: 'incoming' | 'outgoing';

    private session: JsSipRTCSessionLike;
    private listeners: Partial<Record<CallEvent, Listener[]>> = {};
    private wasConnected = false;

    constructor(session: JsSipRTCSessionLike, opts: { from?: string; to?: string }) {
        this.session = session;
        this.direction = session.direction;
        this.parameters = { From: opts.from, To: opts.to };
        this.customParameters = new Map();

        if (session.request?.getHeader) {
            const leadName = session.request.getHeader('X-Lead-Name');
            const customerNumber = session.request.getHeader('X-Customer-Number');
            if (leadName) this.customParameters.set('LeadName', leadName);
            if (customerNumber) this.customParameters.set('CustomerNumber', customerNumber);
        }

        this.wire();
    }

    private wire() {
        this.session.on('progress', () => this.emit('ringing'));

        this.session.on('accepted', () => {
            this.wasConnected = true;
            this.emit('accept');
        });

        this.session.on('ended', () => this.emit('disconnect'));

        this.session.on('failed', (data?: { originator?: string; cause?: string }) => {
            if (this.wasConnected) {
                this.emit('disconnect');
                return;
            }
            if (data?.originator === 'local') {
                this.emit('cancel');
            } else {
                this.emit('error', new Error(data?.cause || 'Call failed'));
                this.emit('cancel');
            }
        });
    }

    on(event: CallEvent, cb: Listener): this {
        (this.listeners[event] ??= []).push(cb);
        return this;
    }

    off(event: CallEvent, cb: Listener): this {
        this.listeners[event] = (this.listeners[event] || []).filter((l) => l !== cb);
        return this;
    }

    private emit(event: CallEvent, ...args: any[]) {
        (this.listeners[event] || []).forEach((cb) => cb(...args));
    }

    accept() {
        this.session.answer({
            mediaConstraints: { audio: true, video: false },
            pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        });
    }

    reject() {
        this.session.terminate();
    }

    disconnect() {
        this.session.terminate();
    }

    mute(shouldMute: boolean) {
        if (shouldMute) this.session.mute({ audio: true });
        else this.session.unmute({ audio: true });
    }

    sendDigits(digits: string) {
        this.session.sendDTMF(digits);
    }
}
