'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTwilio } from '@/contexts/TwilioContext';
import styles from './GlobalDialerFAB.module.css';

export function GlobalDialerFAB() {
    const [isOpen, setIsOpen] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [activeTab, setActiveTab] = useState<'keypad' | 'recent'>('keypad');
    const [recentCalls, setRecentCalls] = useState<string[]>([
        '+1 (307) 207-5599',
        '+1 (415) 890-1234',
        '+1 (800) 444-4444'
    ]);

    const twilio = useTwilio();
    const popupRef = useRef<HTMLDivElement>(null);
    const fabRef = useRef<HTMLButtonElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                popupRef.current &&
                !popupRef.current.contains(event.target as Node) &&
                fabRef.current &&
                !fabRef.current.contains(event.target as Node)
            ) {
                // If on call, keep it open or minimized
                if (twilio.callStatus !== 'connected' && twilio.callStatus !== 'ringing') {
                    setIsOpen(false);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [twilio.callStatus]);

    const playDTMF = (digit: string) => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 400 + (parseInt(digit) || 5) * 45;
            gain.gain.value = 0.08;
            osc.start();
            setTimeout(() => osc.stop(), 50);
        } catch { }
    };

    const handleDigitPress = (digit: string) => {
        playDTMF(digit);
        if (twilio.callStatus === 'connected') {
            twilio.sendDTMF(digit);
        } else {
            setPhoneNumber(prev => prev + digit);
        }
    };

    const handleBackspace = () => {
        setPhoneNumber(prev => prev.slice(0, -1));
    };

    const handleCall = async (numToCall?: string) => {
        const target = numToCall || phoneNumber;
        if (!target.trim()) return;

        if (!recentCalls.includes(target)) {
            setRecentCalls(prev => [target, ...prev.slice(0, 4)]);
        }

        // twilio.makeCall() already registers the call with the active-call state layer
        // synchronously as soon as it's created — calling setActiveCall again here would
        // double-attach listeners to the same Call object.
        await twilio.makeCall(target);
    };

    const isOnCall = twilio.callStatus === 'connected' || twilio.callStatus === 'connecting' || twilio.callStatus === 'ringing';
    const isReady = twilio.deviceStatus === 'ready';

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const dialpadButtons = [
        { digit: '1', letters: '' },
        { digit: '2', letters: 'ABC' },
        { digit: '3', letters: 'DEF' },
        { digit: '4', letters: 'GHI' },
        { digit: '5', letters: 'JKL' },
        { digit: '6', letters: 'MNO' },
        { digit: '7', letters: 'PQRS' },
        { digit: '8', letters: 'TUV' },
        { digit: '9', letters: 'WXYZ' },
        { digit: '*', letters: '' },
        { digit: '0', letters: '+' },
        { digit: '#', letters: '' },
    ];

    return (
        <div className={styles.wrapper}>
            {/* Popover Softphone */}
            {isOpen && (
                <div ref={popupRef} className={styles.dialerCard}>
                    {/* Header */}
                    <div className={styles.cardHeader}>
                        <div className={styles.headerLeft}>
                            <span className={styles.headerLiveDot} />
                            <div>
                                <h4 className={styles.headerTitle}>Netro Scale Softphone</h4>
                                <span className={styles.headerStatus}>
                                    {isOnCall ? `Active Call • ${formatDuration(twilio.duration)}` : isReady ? 'Line 1 • Ready' : 'Connecting...'}
                                </span>
                            </div>
                        </div>
                        <div className={styles.headerRight}>
                            <span className={styles.balanceBadge}>$25.00</span>
                            <button
                                className={styles.closeBtn}
                                onClick={() => setIsOpen(false)}
                                title="Minimize"
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    {/* Active Call Mode */}
                    {isOnCall ? (
                        <div className={styles.activeCallBody}>
                            <div className={styles.callAvatar}>
                                <PhoneIcon />
                            </div>
                            <div className={styles.callRemoteNumber}>
                                {twilio.remoteNumber || phoneNumber || 'Unknown Caller'}
                            </div>
                            <div className={styles.callStatusText}>
                                {twilio.callStatus === 'ringing' ? 'Ringing...' : twilio.callStatus === 'connecting' ? 'Connecting...' : 'Call in progress'}
                            </div>
                            <div className={styles.callTimer}>
                                {formatDuration(twilio.duration)}
                            </div>

                            {/* Active Call Controls */}
                            <div className={styles.callControlsGrid}>
                                <button
                                    className={`${styles.controlBtn} ${twilio.isMuted ? styles.controlBtnActive : ''}`}
                                    onClick={twilio.toggleMute}
                                    title={twilio.isMuted ? 'Unmute' : 'Mute'}
                                >
                                    <MicIcon />
                                    <span>{twilio.isMuted ? 'Unmute' : 'Mute'}</span>
                                </button>
                                <button
                                    className={styles.controlBtn}
                                    onClick={() => setActiveTab(activeTab === 'keypad' ? 'recent' : 'keypad')}
                                    title="Keypad"
                                >
                                    <KeypadIcon />
                                    <span>Keypad</span>
                                </button>
                            </div>

                            {/* In-call Keypad (if open) */}
                            {activeTab === 'keypad' && (
                                <div className={styles.inCallKeypad}>
                                    <div className={styles.keypadGridSmall}>
                                        {dialpadButtons.map(({ digit }) => (
                                            <button
                                                key={digit}
                                                className={styles.keySmall}
                                                onClick={() => handleDigitPress(digit)}
                                            >
                                                {digit}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* End Call Button */}
                            <button
                                className={styles.hangupBtn}
                                onClick={twilio.hangup}
                            >
                                <HangupIcon />
                                <span>End Call</span>
                            </button>
                        </div>
                    ) : (
                        /* Idle Dialer Mode */
                        <div className={styles.dialerBody}>
                            {/* Tabs */}
                            <div className={styles.tabBar}>
                                <button
                                    className={`${styles.tabBtn} ${activeTab === 'keypad' ? styles.tabActive : ''}`}
                                    onClick={() => setActiveTab('keypad')}
                                >
                                    Keypad
                                </button>
                                <button
                                    className={`${styles.tabBtn} ${activeTab === 'recent' ? styles.tabActive : ''}`}
                                    onClick={() => setActiveTab('recent')}
                                >
                                    Recent Dials
                                </button>
                            </div>

                            {activeTab === 'keypad' ? (
                                <>
                                    {/* Number Input Display */}
                                    <div className={styles.displayArea}>
                                        <input
                                            type="tel"
                                            className={styles.numberInput}
                                            placeholder="Enter phone number..."
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && phoneNumber && isReady) {
                                                    handleCall();
                                                }
                                            }}
                                            autoFocus
                                        />
                                        {phoneNumber && (
                                            <button className={styles.backspaceBtn} onClick={handleBackspace}>
                                                <BackspaceIcon />
                                            </button>
                                        )}
                                    </div>

                                    {/* Dialpad Matrix */}
                                    <div className={styles.keypadGrid}>
                                        {dialpadButtons.map(({ digit, letters }) => (
                                            <button
                                                key={digit}
                                                className={styles.key}
                                                onClick={() => handleDigitPress(digit)}
                                            >
                                                <span className={styles.keyDigit}>{digit}</span>
                                                {letters && <span className={styles.keyLetters}>{letters}</span>}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Call Action Bar */}
                                    <div className={styles.actionRow}>
                                        <button
                                            className={`${styles.callBtn} ${phoneNumber.trim() && isReady ? styles.callBtnReady : ''}`}
                                            onClick={() => handleCall()}
                                            disabled={!phoneNumber.trim() || !isReady}
                                        >
                                            <PhoneIcon />
                                            <span>Call {phoneNumber ? phoneNumber : ''}</span>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* Recent List */
                                <div className={styles.recentList}>
                                    {recentCalls.map((num, i) => (
                                        <div key={i} className={styles.recentRow}>
                                            <div className={styles.recentInfo}>
                                                <span className={styles.recentNum}>{num}</span>
                                                <span className={styles.recentTime}>Outgoing • 2 mins ago</span>
                                            </div>
                                            <button
                                                className={styles.recentCallBtn}
                                                onClick={() => {
                                                    setPhoneNumber(num);
                                                    handleCall(num);
                                                }}
                                                title="Call"
                                            >
                                                <PhoneIcon />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Bottom-Right Floating Red Button */}
            <button
                ref={fabRef}
                className={`${styles.fab} ${isOpen ? styles.fabActive : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Open Phone Dialer"
                title="Netro Scale Dialer"
            >
                <div className={styles.fabIconWrapper}>
                    {isOpen ? (
                        <CloseIcon />
                    ) : (
                        <>
                            <PhoneIcon />
                            <span className={styles.fabActiveDot} />
                        </>
                    )}
                </div>
            </button>
        </div>
    );
}

// Icons
function PhoneIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

function HangupIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
    );
}

function MicIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    );
}

function KeypadIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="1.8" />
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="19" cy="5" r="1.8" />
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
            <circle cx="5" cy="19" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
            <circle cx="19" cy="19" r="1.8" />
        </svg>
    );
}

function BackspaceIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
        </svg>
    );
}
