'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { AppLayout } from '@/components/Layout';
import { CallHistoryList, RichDialer } from '@/components/Calls';
import { AutoDialer } from '@/components/AutoDialer';
import { AccessibilityPanel } from '@/components/AccessibilityPanel';
import { AISimulatorModal } from '@/components/AISimulatorModal';
import { useTwilio } from '@/contexts/TwilioContext';
import { useCallHistory } from '@/hooks/useCallHistory';
import styles from './page.module.css';

type CallFilter = 'all' | 'incoming' | 'outgoing' | 'missed';

interface PhoneNumber {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    is_default: boolean;
}

interface LiveSingleAiCall {
    callSid: string;
    number: string;
    status: 'initiated' | 'ringing' | 'in-progress' | 'voicemail' | 'transferring' | 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled';
    duration: number;
    turns: Array<{ role: 'user' | 'assistant' | 'system'; text: string; timestamp: number }>;
    note?: string;
}

function formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function Home() {
    const twilio = useTwilio();
    const { history, setFilter, clearHistory, deleteEntry, refresh: refreshCallHistory } = useCallHistory();

    // Call history is now written server-side, from Twilio's own status callbacks
    // (see src/lib/callHistory.ts) — not by the client. This just nudges a refetch
    // shortly after a call ends so the list updates faster than the hook's own
    // background poll, giving the webhook round-trip time to land first.
    const scheduleHistoryRefresh = useCallback(() => {
        setTimeout(() => { refreshCallHistory(); }, 2500);
    }, [refreshCallHistory]);

    const [callFilter, setCallFilter] = useState<CallFilter>('all');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [showAccessibility, setShowAccessibility] = useState(false);
    const [showAutoDialer, setShowAutoDialer] = useState(false);
    const [user, setUser] = useState<{ email?: string | null } | null>(null);
    const [assignedNumbers, setAssignedNumbers] = useState<PhoneNumber[]>([]);
    const [selectedCallerId, setSelectedCallerId] = useState<string>('');
    const [voiceSettings, setVoiceSettings] = useState<{ call_recording_enabled: boolean; voicemail_enabled: boolean }>({
        call_recording_enabled: false,
        voicemail_enabled: false,
    });

    // Fetch user and actual phone numbers & settings from backend
    useEffect(() => {
        const fetchInitialData = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);

            // Fetch numbers
            try {
                const res = await fetch('/api/user/numbers');
                if (res.ok) {
                    const data = await res.json();
                    if (data.numbers && data.numbers.length > 0) {
                        setAssignedNumbers(data.numbers);
                        const defaultNum = data.numbers.find((n: PhoneNumber) => n.is_default);
                        setSelectedCallerId(defaultNum?.phone_number || data.numbers[0].phone_number);
                    }
                }
            } catch { }

            // Fetch voice settings
            try {
                const res = await fetch('/api/user/voice-settings');
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) {
                        setVoiceSettings({
                            call_recording_enabled: !!data.call_recording_enabled,
                            voicemail_enabled: !!data.voicemail_enabled,
                        });
                    }
                }
            } catch { }
        };

        fetchInitialData();
    }, []);

    // Handle filter change
    const handleFilterChange = (newFilter: CallFilter) => {
        setCallFilter(newFilter);
        setFilter(newFilter);
    };

    // Filter history based on selected filter
    const getFilteredHistory = () => {
        if (callFilter === 'all') return history;
        if (callFilter === 'missed') return history.filter(e => e.status === 'missed');
        if (callFilter === 'incoming') return history.filter(e => e.direction === 'incoming');
        if (callFilter === 'outgoing') return history.filter(e => e.direction === 'outgoing');
        return history;
    };

    // Call Strategy / Mode: direct | script | ai_agent
    const [callMode, setCallMode] = useState<'direct' | 'script' | 'ai_agent'>('direct');
    const [showAISimulator, setShowAISimulator] = useState(false);
    const [activeAiCall, setActiveAiCall] = useState<LiveSingleAiCall | null>(null);

    // Make Call
    const handleCall = async (numberToCallParam?: string) => {
        const numberToCall = numberToCallParam || phoneNumber;
        if (!numberToCall.trim()) return;

        // If in AI Agent mode and calling a customer's phone number:
        if (callMode === 'ai_agent' && numberToCall !== '*99' && numberToCall !== '99') {
            try {
                // Twilio identity is the user UUID used to register the softphone
                const agentUserId = twilio.twilioIdentity
                    || (typeof window !== 'undefined' ? localStorage.getItem('twilio_identity') : null)
                    || 'user';

                const res = await fetch('/api/twilio/ai-call/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: numberToCall,
                        callerId: selectedCallerId,
                        agentUserId,
                    }),
                });

                const data = await res.json();
                if (data.success && data.callSid) {
                    setActiveAiCall({
                        callSid: data.callSid,
                        number: numberToCall,
                        status: 'ringing',
                        duration: 0,
                        turns: [],
                        note: 'Ringing customer phone...',
                    });
                    setPhoneNumber('');
                } else {
                    alert(`Error starting AI call: ${data.error || 'Failed to initiate call'}`);
                }
            } catch (err: any) {
                alert(`Error starting AI call: ${err.message}`);
            }
            return;
        }

        // Direct call, Script call, or *99 Test Call via Softphone
        const effectiveMode = (numberToCall === '*99' || numberToCall === '99') ? 'test' : callMode;

        // twilio.makeCall() registers the call with the active-call state layer itself,
        // synchronously, the instant it's created — do not call setActiveCall again here,
        // that would double-attach listeners to the same Call object (duplicate/leaked
        // duration timers, and a stale setCallStatus('connecting') stomping real progress).
        const call = await twilio.makeCall(numberToCall, selectedCallerId, {
            callMode: effectiveMode,
        });
        if (call) {
            setPhoneNumber('');
        }
    };

    // Live Polling for Single AI Call
    useEffect(() => {
        if (!activeAiCall || !activeAiCall.callSid) return;
        const isTerminal = ['completed', 'voicemail', 'no-answer', 'busy', 'failed', 'canceled'].includes(activeAiCall.status);
        if (isTerminal) return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/twilio/ai-call/status?callSid=${encodeURIComponent(activeAiCall.callSid)}`);
                if (!res.ok) return;
                const json = await res.json();
                if (!json.success || !json.call) return;

                const live = json.call;
                let newStatus = activeAiCall.status;
                let note = activeAiCall.note;

                if (live.status === 'ringing') {
                    newStatus = 'ringing';
                    note = 'Customer phone is ringing...';
                } else if (live.status === 'in-progress') {
                    newStatus = live.transferredToSoftphone ? 'transferring' : 'in-progress';
                    note = live.transferredToSoftphone
                        ? '🔔 Transferring to your Softphone right now!'
                        : (live.lastSpeech ? `Customer: "${live.lastSpeech}"` : 'AI is speaking with customer...');
                } else if (live.status === 'voicemail') {
                    newStatus = 'voicemail';
                    note = '📼 Answering Machine / Voicemail Box Detected (Call ended)';
                } else if (live.status === 'completed') {
                    newStatus = activeAiCall.status === 'voicemail' ? 'voicemail' : 'completed';
                    note = `Call finished (Duration: ${formatDuration(live.duration)})`;
                } else if (live.status === 'busy') {
                    newStatus = 'busy';
                    note = 'Line Busy';
                } else if (live.status === 'no-answer') {
                    newStatus = 'no-answer';
                    note = 'No Answer / Timed Out';
                } else if (live.status === 'failed') {
                    newStatus = 'failed';
                    note = live.error || 'Call Failed';
                } else if (live.status === 'canceled') {
                    newStatus = 'canceled';
                    note = 'Call Cancelled';
                }

                setActiveAiCall(prev => prev ? {
                    ...prev,
                    status: newStatus,
                    duration: live.duration || prev.duration,
                    turns: live.turns || prev.turns,
                    note,
                } : null);

                // Transitioned into a terminal status this tick — the AI-call status
                // webhook (src/app/api/twilio/ai-call/status/route.ts) writes the
                // durable call_history row around the same time; nudge a refetch.
                const terminalStatuses = ['completed', 'voicemail', 'no-answer', 'busy', 'failed', 'canceled'];
                if (!terminalStatuses.includes(activeAiCall.status) && terminalStatuses.includes(newStatus)) {
                    scheduleHistoryRefresh();
                }
            } catch (e) {
                console.warn('[Single AI Call Poller] Error:', e);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [activeAiCall, scheduleHistoryRefresh]);

    const handleCancelSingleAiCall = async () => {
        if (!activeAiCall?.callSid) return;
        try {
            await fetch('/api/twilio/ai-call/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callSid: activeAiCall.callSid }),
            });
            setActiveAiCall(prev => prev ? { ...prev, status: 'canceled', note: 'Cancelled by operator' } : null);
        } catch {}
    };

    // Incoming call disconnected/canceled before being answered: Twilio's own
    // <Client> statusCallback (src/app/api/twilio/webhook/route.ts) will record this
    // as a 'missed' call_history row once its no-answer/canceled callback lands —
    // just nudge a refetch so the list catches up promptly.
    useEffect(() => {
        if (!twilio.incomingCall) return;

        const handleDisconnect = () => {
            if (!twilio.activeCall) scheduleHistoryRefresh();
        };

        twilio.incomingCall.on('disconnect', handleDisconnect);
        twilio.incomingCall.on('cancel', handleDisconnect);

        return () => {
            twilio.incomingCall?.off('disconnect', handleDisconnect);
            twilio.incomingCall?.off('cancel', handleDisconnect);
        };
    }, [twilio.incomingCall, twilio.activeCall, scheduleHistoryRefresh]);

    // Active call ended: same deal — the per-leg statusCallback already recorded the
    // authoritative outcome/duration server-side, this just nudges a refetch.
    useEffect(() => {
        if (!twilio.activeCall) return;

        const handleRemoteDisconnect = () => {
            scheduleHistoryRefresh();
        };

        twilio.activeCall.on('disconnect', handleRemoteDisconnect);

        return () => {
            twilio.activeCall?.off('disconnect', handleRemoteDisconnect);
        };
    }, [twilio.activeCall, scheduleHistoryRefresh]);

    return (
        <AppLayout
            onAccessibilityClick={() => setShowAccessibility(true)}
            callFilter={callFilter}
            onCallFilterChange={handleFilterChange}
            deviceStatus={twilio.deviceStatus}
            error={twilio.deviceError}
            user={user || undefined}
        >
            {/* Accessibility Modal */}
            {showAccessibility && (
                <AccessibilityPanel onClose={() => setShowAccessibility(false)} />
            )}

            <div className={styles.workspace}>
                {/* Top Summary Bar */}
                <div className={styles.statsBar}>
                    {/* Active Caller ID */}
                    <div className={styles.statCard}>
                        <div className={styles.statIconPhone}>
                            <LineIcon />
                        </div>
                        <div className={styles.statInfo}>
                            <span className={styles.statLabel}>Outbound Caller ID</span>
                            <span className={styles.statValueSmall}>
                                {selectedCallerId || (assignedNumbers[0]?.phone_number) || 'Default Twilio Number'}
                            </span>
                        </div>
                    </div>

                    {/* Recording Status */}
                    <div className={styles.statCard}>
                        <div className={styles.statIconMic}>
                            <RecordingIcon />
                        </div>
                        <div className={styles.statInfo}>
                            <span className={styles.statLabel}>Call Recording</span>
                            <span className={styles.statValueSmall}>
                                {voiceSettings.call_recording_enabled ? 'Enabled (Auto)' : 'Disabled'}
                            </span>
                        </div>
                    </div>

                    {/* Voicemail Status */}
                    <div className={styles.statCard}>
                        <div className={styles.statIconVoicemail}>
                            <VoicemailIcon />
                        </div>
                        <div className={styles.statInfo}>
                            <span className={styles.statLabel}>Voicemail Inbox</span>
                            <span className={styles.statValueSmall}>
                                {voiceSettings.voicemail_enabled ? 'Active (Greeting set)' : 'Disabled'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main 2-Column Dialer & Call Log Layout */}
                <div className={styles.mainColumns}>
                    {/* Left: Softphone Keypad & AI Dashboard */}
                    <div className={styles.leftColumn}>
                        <div className={styles.dialerContainer}>
                            <div className={styles.dialerHeader}>
                                <h2 className={styles.dialerTitle}>Netro Scale Softphone</h2>
                                <button
                                    className={`${styles.autoDialBtn} ${showAutoDialer ? styles.autoDialBtnActive : ''}`}
                                    onClick={() => setShowAutoDialer(!showAutoDialer)}
                                    title="Auto Dialer Campaign"
                                >
                                    <ListIcon />
                                    <span>{showAutoDialer ? 'Close Campaign' : '🚀 Auto Dialer'}</span>
                                </button>
                            </div>

                            {/* Call Strategy Selector Tabs */}
                            <div className={styles.strategyTabs}>
                                <button
                                    className={`${styles.strategyBtn} ${callMode === 'direct' ? styles.strategyActive : ''}`}
                                    onClick={() => setCallMode('direct')}
                                >
                                    ⚡ Direct Call
                                </button>
                                <button
                                    className={`${styles.strategyBtn} ${callMode === 'script' ? styles.strategyActive : ''}`}
                                    onClick={() => setCallMode('script')}
                                >
                                    🎙️ Intro Script
                                </button>
                                <button
                                    className={`${styles.strategyBtn} ${callMode === 'ai_agent' ? styles.strategyActiveAI : ''}`}
                                    onClick={() => setCallMode('ai_agent')}
                                >
                                    🤖 AI Voice Agent
                                </button>
                            </div>

                            {/* Active AI Mode Banner */}
                            {callMode === 'ai_agent' && (
                                <div className={styles.aiBadge}>
                                    <div className={styles.aiBadgeHeader}>
                                        <div className={styles.aiPulseDot}></div>
                                        <div className={styles.aiBadgeText}>
                                            <span className={styles.aiBadgeTitle}>AI Voice Agent Ready</span>
                                            <span className={styles.aiBadgeSub}>Uses your saved script &amp; knowledge base — warm transfer to your softphone</span>
                                        </div>
                                    </div>
                                    <div className={styles.aiActions}>
                                        <button
                                            className={styles.aiTestCallBtn}
                                            onClick={() => handleCall('*99')}
                                            title="Speak directly to AI via computer microphone (*99)"
                                        >
                                            🎧 Test Voice in Mic (*99)
                                        </button>
                                        <button
                                            className={styles.aiSimulateBtn}
                                            onClick={() => setShowAISimulator(true)}
                                            title="Open Interactive AI Chat Simulator"
                                        >
                                            🧪 Simulator Studio
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Live AI Single Call Monitor Card */}
                            {activeAiCall && (
                                <div className={styles.liveAiCallCard}>
                                    <div className={styles.liveAiHeader}>
                                        <span className={styles.liveAiTarget}>📞 {activeAiCall.number}</span>
                                        
                                        <span className={`${styles.liveAiStatusPill} ${
                                            activeAiCall.status === 'ringing' ? styles.liveStatus_ringing :
                                            activeAiCall.status === 'in-progress' ? styles.liveStatus_talking :
                                            activeAiCall.status === 'voicemail' ? styles.liveStatus_voicemail :
                                            activeAiCall.status === 'transferring' ? styles.liveStatus_transferring :
                                            activeAiCall.status === 'completed' ? styles.liveStatus_completed :
                                            styles.liveStatus_failed
                                        }`}>
                                            {activeAiCall.status === 'ringing' && '🟡 Ringing...'}
                                            {activeAiCall.status === 'in-progress' && '🟢 In Conversation'}
                                            {activeAiCall.status === 'voicemail' && '📼 Voicemail Box Detected'}
                                            {activeAiCall.status === 'transferring' && '🔔 Transferring to Softphone!'}
                                            {activeAiCall.status === 'completed' && '✅ Call Completed'}
                                            {activeAiCall.status === 'busy' && '🔴 Line Busy'}
                                            {activeAiCall.status === 'no-answer' && '⭕ No Answer'}
                                            {activeAiCall.status === 'failed' && '❌ Failed'}
                                            {activeAiCall.status === 'canceled' && '⏹ Cancelled'}
                                        </span>

                                        {activeAiCall.duration > 0 && (
                                            <span className={styles.liveAiTimer}>{formatDuration(activeAiCall.duration)}</span>
                                        )}
                                    </div>

                                    {/* Streaming Transcript */}
                                    <div className={styles.liveAiTranscript}>
                                        {activeAiCall.turns && activeAiCall.turns.length > 0 ? (
                                            activeAiCall.turns.map((turn, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`${styles.liveAiTurn} ${turn.role === 'user' ? styles.liveAiTurn_user : styles.liveAiTurn_assistant}`}
                                                >
                                                    <div className={styles.liveAiTurnRole}>
                                                        {turn.role === 'user' ? '👤 Customer' : '🤖 AI Agent (Ashley)'}
                                                    </div>
                                                    <div>{turn.text}</div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className={styles.liveAiWaitingText}>
                                                {activeAiCall.note || 'Dialing customer... AI will introduce the claim upon answer.'}
                                            </div>
                                        )}
                                    </div>

                                    <div className={styles.liveAiFooter}>
                                        {(activeAiCall.status === 'ringing' || activeAiCall.status === 'in-progress' || activeAiCall.status === 'transferring') ? (
                                            <button className={styles.liveAiCancelBtn} onClick={handleCancelSingleAiCall}>
                                                ⏹ End AI Call
                                            </button>
                                        ) : (
                                            <button className={styles.liveAiDismissBtn} onClick={() => setActiveAiCall(null)}>
                                                ✕ Dismiss
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Auto Dialer Panel */}
                            {showAutoDialer ? (
                                <div className={styles.autoDialerWrapper}>
                                    <AutoDialer />
                                </div>
                            ) : (
                                /* Interactive Rich Keypad */
                                <div className={styles.keypadWrapper}>
                                    <RichDialer
                                        phoneNumber={phoneNumber}
                                        onPhoneNumberChange={setPhoneNumber}
                                        onCall={() => handleCall()}
                                        isReady={twilio.deviceStatus === 'ready'}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Real Call History */}
                    <div className={styles.rightColumn}>
                        <div className={styles.historyContainer}>
                            <div className={styles.historyHeader}>
                                <div className={styles.filterTabs}>
                                    {(['all', 'incoming', 'outgoing', 'missed'] as CallFilter[]).map((tab) => (
                                        <button
                                            key={tab}
                                            className={`${styles.tabBtn} ${callFilter === tab ? styles.tabActive : ''}`}
                                            onClick={() => handleFilterChange(tab)}
                                        >
                                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                        </button>
                                    ))}
                                </div>

                                {history.length > 0 && (
                                    <button className={styles.clearBtn} onClick={clearHistory}>
                                        Clear History
                                    </button>
                                )}
                            </div>

                            <div className={styles.historyBody}>
                                <CallHistoryList
                                    entries={getFilteredHistory()}
                                    filter={callFilter}
                                    onFilterChange={() => { }}
                                    onCall={(num) => handleCall(num)}
                                    onClear={clearHistory}
                                    onDelete={deleteEntry}
                                    hideFilters={true}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* AI Simulator Modal */}
            <AISimulatorModal
                isOpen={showAISimulator}
                onClose={() => setShowAISimulator(false)}
                onStartBrowserAudioCall={() => handleCall('*99')}
            />
        </AppLayout>
    );
}

// Icons
function LineIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function RecordingIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
    );
}

function VoicemailIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5.5" cy="11.5" r="4.5" />
            <circle cx="18.5" cy="11.5" r="4.5" />
            <line x1="5.5" y1="16" x2="18.5" y2="16" />
        </svg>
    );
}

function ListIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
    );
}
