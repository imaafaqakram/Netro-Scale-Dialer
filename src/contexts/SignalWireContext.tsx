'use client';

import React, { createContext, useContext, ReactNode, useCallback, useState, useEffect } from 'react';
import { SignalWireCall as Call } from '@/lib/signalwire/SignalWireCall';
import { useSignalWireDevice, IncomingCallInfo, CallOptions } from '@/hooks/useSignalWireDevice';
import { useCallState } from '@/hooks/useCallState';
import type { DeviceStatus, CallStatus, CallDirection } from '@/types';

interface SignalWireContextValue {
    // Device
    device: ReturnType<typeof useSignalWireDevice>['device'];
    deviceStatus: DeviceStatus;
    deviceError: string | null;
    incomingCall: Call | null;
    incomingCallInfo: IncomingCallInfo | null;
    sipIdentity: string | null;
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

const SignalWireContext = createContext<SignalWireContextValue | null>(null);

export function useSignalWire(): SignalWireContextValue {
    const context = useContext(SignalWireContext);
    if (!context) {
        throw new Error('useSignalWire must be used within a SignalWireProvider');
    }
    return context;
}

export function SignalWireProvider({ children }: { children: ReactNode }) {
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
    // same tick it's created (see useSignalWireDevice.makeCall) — not after an extra
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
        sipIdentity,
        makeCall,
        acceptIncomingCall: rawAccept,
        rejectIncomingCall: rawReject,
    } = useSignalWireDevice(registerOutgoingCall);

    const [callerDisplayName, setCallerDisplayName] = useState<string | null>(null);

    // Wrap accept to also set call state
    const acceptIncomingCall = useCallback(() => {
        if (incomingCall) {
            // Prefer the real customer number carried via a custom SIP header on a warm
            // transfer over the raw From (which is just the business caller ID otherwise).
            const callerNumber = incomingCallInfo?.customerNumber || incomingCall.parameters.From || 'Unknown';
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

    const value: SignalWireContextValue = {
        device,
        deviceStatus,
        deviceError,
        incomingCall,
        incomingCallInfo,
        sipIdentity,
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
        <SignalWireContext.Provider value={value}>
            {children}
        </SignalWireContext.Provider>
    );
}
