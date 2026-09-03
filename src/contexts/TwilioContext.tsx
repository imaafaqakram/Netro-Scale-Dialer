'use client';

import React, { createContext, useContext, ReactNode, useCallback, useState, useEffect } from 'react';
import { Call } from '@twilio/voice-sdk';
import { useTwilioDevice, IncomingCallInfo } from '@/hooks/useTwilioDevice';
import { useCallState } from '@/hooks/useCallState';
import type { DeviceStatus, CallStatus, CallDirection } from '@/types';

import { CallOptions } from '@/hooks/useTwilioDevice';

interface TwilioContextValue {
    // Device
    device: ReturnType<typeof useTwilioDevice>['device'];
    deviceStatus: DeviceStatus;
    deviceError: string | null;
    incomingCall: Call | null;
    incomingCallInfo: IncomingCallInfo | null;
    twilioIdentity: string | null;
    makeCall: (phoneNumber: string, callerId?: string, options?: CallOptions) => Promise<Call | null>;
    acceptIncomingCall: () => void;
    rejectIncomingCall: () => void;

    // Call state
    activeCall: Call | null;
    callStatus: CallStatus;
    isMuted: boolean;
    duration: number;
    direction: CallDirection | null;
    remoteNumber: string | null;
    /** Lead name captured from the incoming call's custom parameters, kept for the life of the active call. */
    callerDisplayName: string | null;
    setActiveCall: (call: Call | null, direction: CallDirection, explicitNumber?: string) => void;
    hangup: () => void;
    toggleMute: () => void;
    sendDTMF: (digit: string) => void;
}

const TwilioContext = createContext<TwilioContextValue | null>(null);

export function useTwilio(): TwilioContextValue {
    const context = useContext(TwilioContext);
    if (!context) {
        throw new Error('useTwilio must be used within a TwilioProvider');
    }
    return context;
}

export function TwilioProvider({ children }: { children: ReactNode }) {
    const {
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
    } = useCallState();

    // Registers a fresh outgoing Call with the call-state layer synchronously, in the
    // same tick it's created (see useTwilioDevice.makeCall) — not after an extra
    // await/round-trip back through this component, which is where early call events
    // used to get dropped and the active-call UI never showed anything.
    const registerOutgoingCall = useCallback(
        (call: Call, explicitNumber: string) => setActiveCall(call, 'outgoing', explicitNumber),
        [setActiveCall]
    );

    const {
        device,
        status: deviceStatus,
        error: deviceError,
        incomingCall,
        incomingCallInfo,
        twilioIdentity,
        makeCall,
        acceptIncomingCall: rawAccept,
        rejectIncomingCall: rawReject,
    } = useTwilioDevice(registerOutgoingCall);

    const [callerDisplayName, setCallerDisplayName] = useState<string | null>(null);

    // Wrap accept to also set call state
    const acceptIncomingCall = useCallback(() => {
        if (incomingCall) {
            const params = incomingCall.parameters as { From?: string };
            // Prefer the real customer number carried via <Parameter> on a warm transfer
            // over the raw From (which is just the business caller ID on transferred calls).
            const callerNumber = incomingCallInfo?.customerNumber || params.From || 'Unknown';
            setCallerDisplayName(incomingCallInfo?.leadName || null);
            rawAccept();
            setActiveCall(incomingCall, 'incoming', callerNumber);
        }
    }, [incomingCall, incomingCallInfo, rawAccept, setActiveCall]);

    // Wrap reject (just pass through)
    const rejectIncomingCall = useCallback(() => {
        rawReject();
    }, [rawReject]);

    // Clear the lead name once the call ends
    useEffect(() => {
        if (callStatus === 'idle') setCallerDisplayName(null);
    }, [callStatus]);

    const value: TwilioContextValue = {
        device,
        deviceStatus,
        deviceError,
        incomingCall,
        incomingCallInfo,
        twilioIdentity,
        makeCall,
        acceptIncomingCall,
        rejectIncomingCall,
        activeCall,
        callStatus,
        isMuted,
        duration,
        direction,
        remoteNumber,
        callerDisplayName,
        setActiveCall,
        hangup,
        toggleMute,
        sendDTMF,
    };

    return (
        <TwilioContext.Provider value={value}>
            {children}
        </TwilioContext.Provider>
    );
}
