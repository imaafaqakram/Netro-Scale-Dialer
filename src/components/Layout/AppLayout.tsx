'use client';

import React, { ReactNode, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { GlobalDialerFAB } from './GlobalDialerFAB';
import { IncomingCallBanner, ActiveCallPopup } from '@/components/Calls';
import { useSignalWire } from '@/contexts/SignalWireContext';
import styles from './AppLayout.module.css';

type CallFilter = 'all' | 'incoming' | 'outgoing' | 'missed';

interface AppLayoutProps {
    children: ReactNode;
    onAccessibilityClick?: () => void;
    callFilter?: CallFilter;
    onCallFilterChange?: (filter: CallFilter) => void;
    deviceStatus?: 'offline' | 'connecting' | 'ready' | 'busy' | 'error';
    error?: string | null;
    user?: { email?: string | null };
}

export function AppLayout({ children, onAccessibilityClick, callFilter, onCallFilterChange, deviceStatus: propDeviceStatus, error: propError, user }: AppLayoutProps) {
    const signalwire = useSignalWire();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Use props if provided, otherwise fall back to context
    const deviceStatus = propDeviceStatus || signalwire.deviceStatus;
    const error = propError !== undefined ? propError : signalwire.deviceError;

    const isOnCall = signalwire.callStatus === 'connected' || signalwire.callStatus === 'connecting' || signalwire.callStatus === 'ringing';
    const displayNumber = signalwire.remoteNumber || 'Unknown';

    // Is current route the main dialer page? If yes, don't show the duplicate floating dialer FAB
    const isMainDialerPage = pathname === '/' || pathname === '/calls';

    // Close sidebar on route change (mobile UX)
    useEffect(() => {
        setSidebarOpen(false);
    }, [pathname]);

    // Prevent body scroll when sidebar is open on mobile
    useEffect(() => {
        if (sidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [sidebarOpen]);

    return (
        <div className="app">
            {/* Overlay for mobile sidebar */}
            {sidebarOpen && (
                <div
                    className="sidebar-overlay open"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            <Sidebar
                callFilter={callFilter}
                onCallFilterChange={onCallFilterChange}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <div className="main-content">
                <Header
                    onAccessibilityClick={onAccessibilityClick}
                    callFilter={callFilter}
                    deviceStatus={deviceStatus}
                    error={error}
                    user={user}
                    onMenuToggle={() => setSidebarOpen(prev => !prev)}
                />

                {/* Global Incoming Call Banner */}
                {signalwire.incomingCall && !signalwire.activeCall && (
                    <IncomingCallBanner
                        callerNumber={
                            signalwire.incomingCallInfo?.customerNumber
                            || (signalwire.incomingCall.parameters as { From?: string }).From
                            || 'Unknown'
                        }
                        leadName={signalwire.incomingCallInfo?.leadName}
                        onAccept={signalwire.acceptIncomingCall}
                        onReject={signalwire.rejectIncomingCall}
                    />
                )}

                {/* Global Active Call Popup - Single unified active call HUD */}
                {isOnCall && (
                    <ActiveCallPopup
                        remoteNumber={displayNumber}
                        displayName={signalwire.callerDisplayName || undefined}
                        duration={signalwire.duration}
                        isMuted={signalwire.isMuted}
                        onMuteToggle={signalwire.toggleMute}
                        onHangup={signalwire.hangup}
                        onDigit={signalwire.sendDTMF}
                    />
                )}

                <main className={styles.content}>
                    {children}
                </main>
                
                {/* Global FAB Dialer: Only shown on auxiliary pages like /settings or /recordings */}
                {!isMainDialerPage && <GlobalDialerFAB />}
            </div>
        </div>
    );
}
