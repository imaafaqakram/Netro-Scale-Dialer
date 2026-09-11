'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import JsSIP from 'jssip';
import { fetchSipCredentials } from '@/lib/api';
import { SignalWireCall, JsSipRTCSessionLike } from '@/lib/signalwire/SignalWireCall';
import type { DeviceStatus } from '@/types';

export interface CallOptions {
    callerId?: string;
    callMode?: 'direct' | 'script' | 'ai_agent' | 'test';
    customScript?: string;
    customGreeting?: string;
}

export interface IncomingCallInfo {
    leadName?: string;
    customerNumber?: string;
}

interface UseSignalWireDeviceReturn {
    device: JsSIP.UA | null;
    status: DeviceStatus;
    error: string | null;
    incomingCall: SignalWireCall | null;
    incomingCallInfo: IncomingCallInfo | null;
    sipIdentity: string | null;
    makeCall: (phoneNumber: string, callerId?: string, options?: CallOptions) => Promise<SignalWireCall | null>;
    acceptIncomingCall: () => void;
    rejectIncomingCall: () => void;
}

// Single shared <audio> element for remote call audio — JsSIP (unlike Twilio's
// Device SDK) doesn't play media for you; it just hands you the underlying
// RTCPeerConnection and expects the app to attach the remote track itself.
function getOrCreateRemoteAudioEl(): HTMLAudioElement {
    const existingId = 'sw-remote-audio';
    let el = document.getElementById(existingId) as HTMLAudioElement | null;
    if (!el) {
        el = document.createElement('audio');
        el.id = existingId;
        el.autoplay = true;
        document.body.appendChild(el);
    }
    return el;
}

function attachMedia(session: JsSipRTCSessionLike) {
    (session as any).connection?.addEventListener?.('track', (event: RTCTrackEvent) => {
        getOrCreateRemoteAudioEl().srcObject = event.streams[0];
    });
}

export function useSignalWireDevice(
    onOutgoingCall?: (call: SignalWireCall, explicitNumber: string) => void
): UseSignalWireDeviceReturn {
    const [device, setDevice] = useState<JsSIP.UA | null>(null);
    const [status, setStatus] = useState<DeviceStatus>('offline');
    const [error, setError] = useState<string | null>(null);
    const [incomingCall, setIncomingCall] = useState<SignalWireCall | null>(null);
    const [incomingCallInfo, setIncomingCallInfo] = useState<IncomingCallInfo | null>(null);
    const [sipIdentity, setSipIdentity] = useState<string | null>(null);

    const uaRef = useRef<JsSIP.UA | null>(null);
    const domainRef = useRef<string>('');
    const isDestroyed = useRef(false);

    const initializeDevice = useCallback(async () => {
        if (isDestroyed.current) return;

        try {
            setStatus('connecting');
            setError(null);

            const creds = await fetchSipCredentials();
            if (isDestroyed.current) return;

            setSipIdentity(creds.identity);
            try { localStorage.setItem('sip_identity', creds.identity); } catch {}
            domainRef.current = creds.domain;

            if (uaRef.current) {
                uaRef.current.stop();
                uaRef.current = null;
            }

            const socket = new JsSIP.WebSocketInterface(creds.wsUri);
            const ua = new JsSIP.UA({
                sockets: [socket],
                uri: `sip:${creds.username}@${creds.domain}`,
                password: creds.password,
                display_name: 'Netro Scale',
                register: true,
                session_timers: false,
            });

            ua.on('registered', () => {
                setStatus('ready');
                setError(null);
            });

            ua.on('registrationFailed', (data: { cause?: string }) => {
                console.error('SIP registration failed:', data?.cause);
                setError(data?.cause || 'SIP registration failed');
                setStatus('error');
            });

            ua.on('disconnected', () => {
                setStatus('offline');
            });

            ua.on('newRTCSession', (data: { session: JsSipRTCSessionLike; originator: 'local' | 'remote' }) => {
                const { session, originator } = data;
                attachMedia(session);

                if (originator !== 'remote') return; // outgoing calls are wrapped directly in makeCall()

                const remoteUser = session.remote_identity?.uri?.user || 'Unknown';
                const call = new SignalWireCall(session, { from: remoteUser, to: creds.username });

                setIncomingCall(call);
                setStatus('busy');

                const leadName = call.customParameters.get('LeadName');
                const customerNumber = call.customParameters.get('CustomerNumber');
                setIncomingCallInfo(leadName || customerNumber ? { leadName, customerNumber } : null);

                call.on('cancel', () => {
                    setIncomingCall(null);
                    setIncomingCallInfo(null);
                    setStatus('ready');
                });
                call.on('disconnect', () => {
                    setIncomingCall(null);
                    setIncomingCallInfo(null);
                    setStatus('ready');
                });
            });

            ua.start();

            if (isDestroyed.current) {
                ua.stop();
                return;
            }

            uaRef.current = ua;
            setDevice(ua);
        } catch (err) {
            console.error('Failed to initialize SignalWire device:', err);
            if (!isDestroyed.current) {
                setError(err instanceof Error ? err.message : 'Failed to initialize device');
                setStatus('error');
            }
        }
    }, []);

    const makeCall = useCallback(async (phoneNumber: string, callerId?: string, options?: CallOptions): Promise<SignalWireCall | null> => {
        if (!uaRef.current || status !== 'ready') {
            setError('Device not ready');
            return null;
        }

        try {
            setStatus('busy');
            const cleanNumber = phoneNumber.trim().replace(/[\s()-]/g, '');
            const effectiveCallerId = callerId ? callerId.trim().replace(/[\s()-]/g, '') : '';
            const domain = domainRef.current;

            console.log('[SignalWire Device] Connecting outbound call to:', cleanNumber, 'callerId:', effectiveCallerId, 'mode:', options?.callMode);

            const target = `sip:${cleanNumber}@${domain}`;
            const extraHeaders = [
                `X-Call-Mode: ${options?.callMode || 'direct'}`,
                effectiveCallerId ? `X-Caller-Id: ${effectiveCallerId}` : null,
            ].filter(Boolean) as string[];

            const rawSession = uaRef.current.call(target, {
                mediaConstraints: { audio: true, video: false },
                extraHeaders,
            }) as unknown as JsSipRTCSessionLike;

            const call = new SignalWireCall(rawSession, { from: effectiveCallerId, to: cleanNumber });

            // Registered synchronously, in this same continuation — mirrors the old
            // Twilio Device behavior: any 'ringing'/'accept'/'disconnect' that fires
            // before a later tick would otherwise be dropped for good.
            onOutgoingCall?.(call, phoneNumber);

            call.on('disconnect', () => setStatus('ready'));
            call.on('cancel', () => setStatus('ready'));

            return call;
        } catch (err) {
            console.error('Failed to make call:', err);
            setError(err instanceof Error ? err.message : 'Failed to make call');
            setStatus('ready');
            return null;
        }
    }, [status, onOutgoingCall]);

    const acceptIncomingCall = useCallback(() => {
        incomingCall?.accept();
    }, [incomingCall]);

    const rejectIncomingCall = useCallback(() => {
        if (incomingCall) {
            incomingCall.reject();
            setIncomingCall(null);
            setIncomingCallInfo(null);
            setStatus('ready');
        }
    }, [incomingCall]);

    useEffect(() => {
        isDestroyed.current = false;

        // Unlike Twilio's short-lived JWT, this SIP password doesn't expire, so
        // there's no periodic-refresh call here — recreating the UA on a timer
        // would tear down any in-progress call for no reason.
        initializeDevice();

        return () => {
            isDestroyed.current = true;
            if (uaRef.current) {
                uaRef.current.stop();
                uaRef.current = null;
            }
        };
    }, [initializeDevice]);

    return {
        device,
        status,
        error,
        incomingCall,
        incomingCallInfo,
        sipIdentity,
        makeCall,
        acceptIncomingCall,
        rejectIncomingCall,
    };
}
