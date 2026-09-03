'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Call } from '@twilio/voice-sdk';
import type { CallStatus, CallDirection } from '@/types';

interface UseCallStateReturn {
    activeCall: Call | null;
    callStatus: CallStatus;
    isMuted: boolean;
    duration: number;
    direction: CallDirection | null;
    remoteNumber: string | null;
    setActiveCall: (call: Call | null, direction: CallDirection, explicitNumber?: string) => void;
    hangup: () => void;
    toggleMute: () => void;
    sendDTMF: (digit: string) => void;
    clearCall: () => void;
}

export function useCallState(): UseCallStateReturn {
    const [activeCall, setActiveCallState] = useState<Call | null>(null);
    const [callStatus, setCallStatus] = useState<CallStatus>('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [duration, setDuration] = useState(0);
    const [direction, setDirection] = useState<CallDirection | null>(null);
    const [remoteNumber, setRemoteNumber] = useState<string | null>(null);

    const durationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const callStartTime = useRef<Date | null>(null);

    // Start duration timer
    const startDurationTimer = useCallback(() => {
        callStartTime.current = new Date();
        durationInterval.current = setInterval(() => {
            if (callStartTime.current) {
                const elapsed = Math.floor((Date.now() - callStartTime.current.getTime()) / 1000);
                setDuration(elapsed);
            }
        }, 1000);
    }, []);

    // Stop duration timer
    const stopDurationTimer = useCallback(() => {
        if (durationInterval.current) {
            clearInterval(durationInterval.current);
            durationInterval.current = null;
        }
        callStartTime.current = null;
    }, []);

    // Set active call with event listeners
    const setActiveCall = useCallback((call: Call | null, callDirection: CallDirection, explicitNumber?: string) => {
        if (!call) {
            setActiveCallState(null);
            setCallStatus('idle');
            setDirection(null);
            setRemoteNumber(null);
            stopDurationTimer();
            setDuration(0);
            setIsMuted(false);
            return;
        }

        // Guard against re-registering the same call twice (would double-attach listeners
        // and double-count the duration timer). Each call object should be wired up once.
        if (call === activeCall) return;

        setActiveCallState(call);
        setDirection(callDirection);
        setCallStatus('connecting');

        // Get remote number - use explicit number if provided, otherwise try to get from call parameters
        if (explicitNumber) {
            setRemoteNumber(explicitNumber);
        } else {
            const params = call.parameters as { From?: string; To?: string };
            const number = callDirection === 'incoming' ? params.From : params.To;
            setRemoteNumber(number || 'Unknown');
        }

        // Set up call event listeners
        call.on('ringing', () => {
            setCallStatus('ringing');
        });

        call.on('accept', () => {
            setCallStatus('connected');
            startDurationTimer();
        });

        call.on('disconnect', () => {
            setCallStatus('disconnected');
            stopDurationTimer();
            setTimeout(() => {
                setActiveCallState(null);
                setCallStatus('idle');
                setDirection(null);
                setDuration(0);
                setIsMuted(false);
            }, 1000);
        });

        call.on('cancel', () => {
            setCallStatus('disconnected');
            stopDurationTimer();
            setActiveCallState(null);
            setCallStatus('idle');
            setDirection(null);
            setDuration(0);
            setIsMuted(false);
        });

        call.on('error', (error) => {
            console.error('Call error:', error);
            setCallStatus('disconnected');
            stopDurationTimer();
        });
    }, [activeCall, startDurationTimer, stopDurationTimer]);

    // Hangup call
    const hangup = useCallback(() => {
        if (activeCall) {
            activeCall.disconnect();
        }
    }, [activeCall]);

    // Toggle mute
    const toggleMute = useCallback(() => {
        if (activeCall) {
            const newMuteState = !isMuted;
            activeCall.mute(newMuteState);
            setIsMuted(newMuteState);
        }
    }, [activeCall, isMuted]);

    // Send DTMF digit
    const sendDTMF = useCallback((digit: string) => {
        if (activeCall && callStatus === 'connected') {
            activeCall.sendDigits(digit);
        }
    }, [activeCall, callStatus]);

    // Clear call state
    const clearCall = useCallback(() => {
        setActiveCallState(null);
        setCallStatus('idle');
        setDirection(null);
        setRemoteNumber(null);
        setDuration(0);
        setIsMuted(false);
        stopDurationTimer();
    }, [stopDurationTimer]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopDurationTimer();
        };
    }, [stopDurationTimer]);

    return {
        activeCall,
        callStatus,
        isMuted,
        duration,
        direction,
        remoteNumber,
        setActiveCall,
        hangup,
        toggleMute,
        sendDTMF,
        clearCall,
    };
}
