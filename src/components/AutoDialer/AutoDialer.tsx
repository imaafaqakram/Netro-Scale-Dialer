'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useTwilio } from '@/contexts/TwilioContext';
import styles from './AutoDialer.module.css';

type DialStatus = 'pending' | 'queued' | 'dialing' | 'connected' | 'voicemail' | 'transferring' | 'completed' | 'no-answer' | 'busy' | 'failed' | 'cancelled' | 'skipped';
type RunState = 'idle' | 'running' | 'paused' | 'done';
type AutoDialMode = 'direct' | 'ai_agent';

interface TurnMessage {
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp: number;
}

interface DialEntry {
    id: string;
    number: string;
    name?: string;
    email?: string;
    status: DialStatus;
    callSid?: string;
    duration?: number;
    note?: string;
    lastSpeech?: string;
    lastAiReply?: string;
    stage?: string;
    turns?: TurnMessage[];
}

interface CampaignStats {
    pending: number;
    queued: number;
    dialing: number;
    connected: number;
    voicemail: number;
    transferring: number;
    completed: number;
    noAnswer: number;
    busy: number;
    failed: number;
    cancelled: number;
    skipped: number;
}

function cleanPhoneNumber(raw: string): string {
    const trimmed = raw.trim().replace(/^["']|["']$/g, '');
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length === 10) return `+1${digitsOnly}`;
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return `+${digitsOnly}`;
    if (digitsOnly.length >= 7) return trimmed.startsWith('+') ? trimmed : `+${digitsOnly}`;
    return '';
}

function formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function AutoDialer() {
    const twilio = useTwilio();
    const [entries, setEntries] = useState<DialEntry[]>([]);
    const [runState, setRunState] = useState<RunState>('idle');
    const [dialMode, setDialMode] = useState<AutoDialMode>('ai_agent');
    const [concurrencyLimit, setConcurrencyLimit] = useState(1);
    const [delaySeconds, setDelaySeconds] = useState(3);
    const [fileName, setFileName] = useState('');
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

    const runStateRef = useRef<RunState>('idle');
    const entriesRef = useRef<DialEntry[]>([]);
    const twilioRef = useRef(twilio);
    const activeCallsRef = useRef<Set<string>>(new Set()); // track entry IDs currently dialing/active
    const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Track current softphone call status for direct mode
    const prevCallStatusRef = useRef(twilio.callStatus);
    const directActiveEntryIdRef = useRef<string | null>(null);

    runStateRef.current = runState;
    entriesRef.current = entries;
    twilioRef.current = twilio;

    // ── Computed stats ─────────────────────────────────────────────────────────
    const stats: CampaignStats = {
        pending: entries.filter(e => e.status === 'pending').length,
        queued: entries.filter(e => e.status === 'queued').length,
        dialing: entries.filter(e => e.status === 'dialing').length,
        connected: entries.filter(e => e.status === 'connected').length,
        voicemail: entries.filter(e => e.status === 'voicemail').length,
        transferring: entries.filter(e => e.status === 'transferring').length,
        completed: entries.filter(e => e.status === 'completed').length,
        noAnswer: entries.filter(e => e.status === 'no-answer').length,
        busy: entries.filter(e => e.status === 'busy').length,
        failed: entries.filter(e => e.status === 'failed').length,
        cancelled: entries.filter(e => e.status === 'cancelled').length,
        skipped: entries.filter(e => e.status === 'skipped').length,
    };
    const totalProcessed = stats.completed + stats.voicemail + stats.noAnswer + stats.busy + stats.failed + stats.cancelled + stats.skipped;
    const progressPct = entries.length > 0 ? Math.round((totalProcessed / entries.length) * 100) : 0;

    // ── File Parsing ────────────────────────────────────────────────────────────
    const parseFile = async (file: File) => {
        try {
            setFileName(file.name);
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            const parsedLeads: DialEntry[] = [];
            const seenNumbers = new Set<string>();

            let phoneColIdx = -1;
            let nameColIdx = -1;
            let emailColIdx = -1;

            if (rows.length > 0) {
                const headerRow = rows[0].map(c => String(c).toLowerCase().trim());
                phoneColIdx = headerRow.findIndex(h =>
                    h.includes('phone') || h.includes('tel') || h.includes('mobile') || h.includes('cell') || h.includes('number') || h.includes('contact')
                );
                nameColIdx = headerRow.findIndex(h =>
                    h.includes('name') || h.includes('first') || h.includes('lead') || h.includes('customer') || h.includes('client')
                );
                emailColIdx = headerRow.findIndex(h => h.includes('email') || h.includes('e-mail'));
            }

            const startRow = (phoneColIdx !== -1) ? 1 : 0;
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            for (let r = startRow; r < rows.length; r++) {
                const row = rows[r];
                if (!row || !row.length) continue;

                let foundNumber = '';
                let foundName = '';
                let foundEmail = '';

                if (phoneColIdx !== -1 && row[phoneColIdx] !== undefined) {
                    foundNumber = cleanPhoneNumber(String(row[phoneColIdx]));
                    if (nameColIdx !== -1 && row[nameColIdx] !== undefined) {
                        foundName = String(row[nameColIdx]).trim();
                    }
                    if (emailColIdx !== -1 && row[emailColIdx] !== undefined) {
                        const cell = String(row[emailColIdx]).trim();
                        if (emailPattern.test(cell)) foundEmail = cell;
                    }
                } else {
                    for (let c = 0; c < row.length; c++) {
                        const cleaned = cleanPhoneNumber(String(row[c] || '').trim());
                        if (cleaned) {
                            foundNumber = cleaned;
                            const otherCell = row.find((val, idx) => idx !== c && String(val).trim().length > 1 && !/\d{5,}/.test(String(val)) && !emailPattern.test(String(val).trim()));
                            if (otherCell) foundName = String(otherCell).trim();
                            break;
                        }
                    }
                    const emailCell = row.find((val) => emailPattern.test(String(val).trim()));
                    if (emailCell) foundEmail = String(emailCell).trim();
                }

                if (foundNumber && !seenNumbers.has(foundNumber)) {
                    seenNumbers.add(foundNumber);
                    parsedLeads.push({
                        id: `lead-${parsedLeads.length + 1}-${Date.now()}`,
                        number: foundNumber,
                        name: foundName,
                        email: foundEmail,
                        status: 'pending',
                    });
                }
            }

            if (!parsedLeads.length) {
                alert(`No valid phone numbers found in "${file.name}".`);
                return;
            }

            setEntries(parsedLeads);
            setRunState('idle');
            activeCallsRef.current.clear();
            setSelectedEntryId(parsedLeads[0]?.id || null);
        } catch (err: any) {
            alert(`Error reading file: ${err.message || 'Unable to parse spreadsheet'}`);
        }
    };

    // ── Dial a single entry ────────────────────────────────────────────────────
    const dialEntry = useCallback(async (entryId: string) => {
        const all = entriesRef.current;
        const entry = all.find(e => e.id === entryId);
        if (!entry) return;

        // Mark as dialing
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: 'dialing', note: 'Dialing customer...' } : e));
        activeCallsRef.current.add(entryId);

        if (dialMode === 'ai_agent') {
            try {
                const agentUserId = twilioRef.current.twilioIdentity
                    || (typeof window !== 'undefined' ? localStorage.getItem('twilio_identity') : null)
                    || 'user';

                const res = await fetch('/api/twilio/ai-call/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: entry.number,
                        agentUserId,
                        leadName: entry.name || '',
                        leadEmail: entry.email || '',
                        leadId: entry.id,
                    }),
                });
                const data = await res.json();

                if (data.success && data.callSid) {
                    setEntries(prev => prev.map(e =>
                        e.id === entryId
                            ? { ...e, status: 'dialing', callSid: data.callSid, note: 'Ringing customer phone...' }
                            : e
                    ));
                } else {
                    activeCallsRef.current.delete(entryId);
                    setEntries(prev => prev.map(e =>
                        e.id === entryId ? { ...e, status: 'failed', note: data.error || 'Failed to initiate call' } : e
                    ));
                    if (runStateRef.current === 'running') {
                        setTimeout(() => fillQueue(), delaySeconds * 1000);
                    }
                }
            } catch (err: any) {
                activeCallsRef.current.delete(entryId);
                setEntries(prev => prev.map(e =>
                    e.id === entryId ? { ...e, status: 'failed', note: err.message } : e
                ));
                if (runStateRef.current === 'running') {
                    setTimeout(() => fillQueue(), delaySeconds * 1000);
                }
            }
        } else {
            // Direct softphone mode
            directActiveEntryIdRef.current = entryId;
            // twilioRef.current.makeCall() already registers the call with the active-call
            // state layer synchronously as soon as it's created — do not call setActiveCall
            // again here, that would double-attach listeners to the same Call object.
            const call = await twilioRef.current.makeCall(entry.number);
            if (!call) {
                activeCallsRef.current.delete(entryId);
                directActiveEntryIdRef.current = null;
                setEntries(prev => prev.map(e =>
                    e.id === entryId ? { ...e, status: 'failed', note: 'Softphone unavailable' } : e
                ));
                if (runStateRef.current === 'running') fillQueue();
            }
        }
    }, [dialMode, delaySeconds]);

    // ── Fill queue up to concurrency limit ────────────────────────────────────
    const fillQueue = useCallback(() => {
        if (runStateRef.current !== 'running') return;

        const all = entriesRef.current;
        const active = activeCallsRef.current;
        const limit = dialMode === 'direct' ? 1 : concurrencyLimit;
        const availableSlots = limit - active.size;

        if (availableSlots <= 0) return;

        const pendingEntries = all.filter(e => e.status === 'pending');

        const toQueue = pendingEntries.slice(0, availableSlots);
        if (toQueue.length === 0) {
            if (active.size === 0) {
                setRunState('done');
            }
            return;
        }

        // Start dialing each available slot
        for (const entry of toQueue) {
            dialEntry(entry.id);
        }
    }, [dialMode, concurrencyLimit, dialEntry]);

    // ── Real-Time Status Polling for AI Calls ─────────────────────────────────
    useEffect(() => {
        if (dialMode !== 'ai_agent') return;

        const pollActiveCalls = async () => {
            const currentEntries = entriesRef.current;
            const activeEntries = currentEntries.filter(
                e => (e.status === 'dialing' || e.status === 'connected' || e.status === 'transferring') && e.callSid
            );

            if (!activeEntries.length) return;

            const sidList = activeEntries.map(e => e.callSid!).join(',');
            try {
                const res = await fetch(`/api/twilio/ai-call/status?callSids=${encodeURIComponent(sidList)}`);
                if (!res.ok) return;
                const json = await res.json();
                if (!json.success || !json.calls) return;

                const liveCallsMap = json.calls as Record<string, any>;
                let slotFreed = false;

                setEntries(prev => prev.map(entry => {
                    if (!entry.callSid || !liveCallsMap[entry.callSid]) return entry;
                    const live = liveCallsMap[entry.callSid];

                    let newStatus = entry.status;
                    let note = entry.note;

                    if (live.status === 'ringing') {
                        newStatus = 'dialing';
                        note = 'Ringing customer phone...';
                    } else if (live.status === 'in-progress') {
                        newStatus = live.transferredToSoftphone ? 'transferring' : 'connected';
                        if (live.transferredToSoftphone) {
                            note = '🔔 Transferring to your softphone!';
                        } else if (live.lastSpeech) {
                            note = `Customer: "${live.lastSpeech}"`;
                        } else {
                            note = 'AI is speaking to customer...';
                        }
                    } else if (live.status === 'voicemail') {
                        newStatus = 'voicemail';
                        note = '📼 Answering Machine / Voicemail Box Detected';
                    } else if (live.status === 'completed') {
                        newStatus = entry.status === 'voicemail' ? 'voicemail' : 'completed';
                        note = `Finished (Duration: ${formatDuration(live.duration)})`;
                    } else if (live.status === 'busy') {
                        newStatus = 'busy';
                        note = 'Line Busy';
                    } else if (live.status === 'no-answer') {
                        newStatus = 'no-answer';
                        note = 'No Answer / Ring Timed Out';
                    } else if (live.status === 'failed') {
                        newStatus = 'failed';
                        note = live.error || 'Call Failed';
                    } else if (live.status === 'canceled' || live.status === 'cancelled') {
                        newStatus = 'cancelled';
                        note = 'Call Cancelled';
                    }

                    // Check if call reached a terminal state
                    const isTerminal = ['completed', 'voicemail', 'no-answer', 'busy', 'failed', 'cancelled'].includes(newStatus);
                    if (isTerminal && activeCallsRef.current.has(entry.id)) {
                        activeCallsRef.current.delete(entry.id);
                        slotFreed = true;
                    }

                    return {
                        ...entry,
                        status: newStatus,
                        duration: live.duration || entry.duration,
                        note,
                        lastSpeech: live.lastSpeech || entry.lastSpeech,
                        lastAiReply: live.lastAiReply || entry.lastAiReply,
                        stage: live.currentStage || entry.stage,
                        turns: live.turns || entry.turns,
                    };
                }));

                // If any slot was freed and campaign is running, schedule next batch
                if (slotFreed && runStateRef.current === 'running') {
                    if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
                    queueTimerRef.current = setTimeout(() => {
                        fillQueue();
                    }, delaySeconds * 1000);
                }
            } catch (err) {
                console.warn('[AutoDialer Poller] Error checking status:', err);
            }
        };

        pollTimerRef.current = setInterval(pollActiveCalls, 1200);
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [dialMode, delaySeconds, fillQueue]);

    // ── Watch direct softphone call status changes ────────────────────────────
    useEffect(() => {
        if (dialMode !== 'direct') return;
        const prev = prevCallStatusRef.current;
        prevCallStatusRef.current = twilio.callStatus;

        const activeEntryId = directActiveEntryIdRef.current;
        if (!activeEntryId) return;

        if (twilio.callStatus === 'connected') {
            setEntries(p => p.map(e =>
                e.id === activeEntryId ? { ...e, status: 'connected', note: 'Talking on Softphone' } : e
            ));
        }

        if (twilio.callStatus === 'idle' && prev !== 'idle') {
            const wasConnected = prev === 'connected';
            activeCallsRef.current.delete(activeEntryId);
            directActiveEntryIdRef.current = null;
            setEntries(p => p.map(e =>
                e.id === activeEntryId
                    ? { ...e, status: wasConnected ? 'completed' : 'no-answer', duration: twilio.duration, note: wasConnected ? 'Completed' : 'No Answer' }
                    : e
            ));
            if (runStateRef.current === 'running') {
                setTimeout(() => fillQueue(), delaySeconds * 1000);
            }
        }
    }, [twilio.callStatus, twilio.duration, dialMode, delaySeconds, fillQueue]);

    // Cleanup on unmount
    useEffect(() => () => {
        if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }, []);

    // ── Campaign Actions ──────────────────────────────────────────────────────
    const handleStart = () => {
        if (!entries.length) return;
        setRunState('running');
        fillQueue();
    };

    const handlePause = () => {
        setRunState('paused');
        if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
    };

    const handleResume = () => {
        setRunState('running');
        fillQueue();
    };

    const handleStopAll = async () => {
        setRunState('idle');
        if (queueTimerRef.current) clearTimeout(queueTimerRef.current);

        const activeEntries = entriesRef.current.filter(
            e => (e.status === 'dialing' || e.status === 'connected' || e.status === 'transferring') && e.callSid
        );

        for (const entry of activeEntries) {
            try {
                await fetch('/api/twilio/ai-call/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callSid: entry.callSid }),
                });
            } catch {}
        }

        if (dialMode === 'direct') {
            twilioRef.current.hangup();
        }

        activeCallsRef.current.clear();
        directActiveEntryIdRef.current = null;

        setEntries(prev => prev.map(e =>
            (e.status === 'dialing' || e.status === 'connected' || e.status === 'queued' || e.status === 'transferring')
                ? { ...e, status: 'cancelled', note: 'Cancelled by operator' }
                : e
        ));
    };

    const handleRetryFailed = () => {
        setEntries(prev => prev.map(e =>
            (e.status === 'failed' || e.status === 'no-answer' || e.status === 'busy' || e.status === 'cancelled' || e.status === 'voicemail')
                ? { ...e, status: 'pending', callSid: undefined, note: undefined, turns: undefined }
                : e
        ));
        setRunState('running');
        setTimeout(() => fillQueue(), 100);
    };

    const handleClear = () => {
        handleStopAll();
        setEntries([]);
        setFileName('');
        setSelectedEntryId(null);
    };

    const handleCancelEntry = async (entry: DialEntry) => {
        if (entry.callSid) {
            try {
                await fetch('/api/twilio/ai-call/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callSid: entry.callSid }),
                });
            } catch {}
        }
        activeCallsRef.current.delete(entry.id);
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'cancelled', note: 'Cancelled manually' } : e));
        if (runStateRef.current === 'running') fillQueue();
    };

    const handleSkipEntry = (id: string) => {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, status: 'skipped', note: 'Skipped' } : e));
    };

    const selectedEntry = entries.find(e => e.id === selectedEntryId);

    return (
        <div className={styles.container}>
            {/* ── Header ── */}
            <div className={styles.header}>
                <div className={styles.headerTitleRow}>
                    <span className={styles.title}>🚀 AUTO DIALER CAMPAIGN</span>
                    {fileName && <span className={styles.fileBadge} title={fileName}>📄 {fileName}</span>}
                </div>
                {entries.length > 0 && (
                    <span className={styles.progress}>
                        {totalProcessed} / {entries.length} ({progressPct}%)
                    </span>
                )}
            </div>

            {/* ── Stats Bar ── */}
            {entries.length > 0 && (
                <>
                    <div className={styles.statsBar}>
                        <div className={`${styles.statPill} ${styles.statPill_muted}`}>
                            <span className={styles.statCount}>{stats.pending}</span>
                            <span className={styles.statLabel}>Pending</span>
                        </div>
                        {stats.dialing > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_warning} ${styles.statPillPulse}`}>
                                <span className={styles.statCount}>{stats.dialing}</span>
                                <span className={styles.statLabel}>🟡 Ringing</span>
                            </div>
                        )}
                        {stats.connected > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_primary} ${styles.statPillPulse}`}>
                                <span className={styles.statCount}>{stats.connected}</span>
                                <span className={styles.statLabel}>🟢 AI Talking</span>
                            </div>
                        )}
                        {stats.voicemail > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_voicemail}`}>
                                <span className={styles.statCount}>{stats.voicemail}</span>
                                <span className={styles.statLabel}>📼 Voicemail</span>
                            </div>
                        )}
                        {stats.transferring > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_primary} ${styles.statPillPulse}`}>
                                <span className={styles.statCount}>{stats.transferring}</span>
                                <span className={styles.statLabel}>🔔 Transferring</span>
                            </div>
                        )}
                        <div className={`${styles.statPill} ${styles.statPill_success}`}>
                            <span className={styles.statCount}>{stats.completed}</span>
                            <span className={styles.statLabel}>Completed</span>
                        </div>
                        {(stats.noAnswer + stats.busy) > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_muted}`}>
                                <span className={styles.statCount}>{stats.noAnswer + stats.busy}</span>
                                <span className={styles.statLabel}>No Answer</span>
                            </div>
                        )}
                        {stats.failed > 0 && (
                            <div className={`${styles.statPill} ${styles.statPill_danger}`}>
                                <span className={styles.statCount}>{stats.failed}</span>
                                <span className={styles.statLabel}>Failed</span>
                            </div>
                        )}
                    </div>
                    <div className={styles.progressBarWrap}>
                        <div className={styles.progressBar} style={{ width: `${progressPct}%` }} />
                    </div>
                </>
            )}

            {/* ── Configuration Bar ── */}
            <div className={styles.configBar}>
                {/* Dial Mode */}
                <div className={styles.modeToggleGroup}>
                    <button
                        className={`${styles.modeBtn} ${dialMode === 'ai_agent' ? styles.modeBtnActiveAI : ''}`}
                        onClick={() => setDialMode('ai_agent')}
                        disabled={runState === 'running'}
                        title="AI voice agent dials in the cloud using your saved script, detects voicemails, and warm-transfers answered calls to you"
                    >
                        🤖 AI Agent
                    </button>
                    <button
                        className={`${styles.modeBtn} ${dialMode === 'direct' ? styles.modeBtnActive : ''}`}
                        onClick={() => setDialMode('direct')}
                        disabled={runState === 'running'}
                        title="Direct 1-by-1 softphone calling through your browser headset"
                    >
                        🎧 Softphone
                    </button>
                </div>

                {/* Concurrency Limit */}
                {dialMode === 'ai_agent' && (
                    <div className={styles.configGroup}>
                        <span className={styles.configLabel}>Lines:</span>
                        <select
                            className={styles.configSelect}
                            value={concurrencyLimit}
                            onChange={e => setConcurrencyLimit(Number(e.target.value))}
                            disabled={runState === 'running'}
                        >
                            <option value={1}>1 Line (Sequential)</option>
                            <option value={2}>2 Lines (Concurrent)</option>
                            <option value={3}>3 Lines (Fast)</option>
                            <option value={5}>5 Lines (Power Dial)</option>
                        </select>
                    </div>
                )}

                {/* Delay between calls */}
                <div className={styles.configGroup}>
                    <span className={styles.configLabel}>Delay:</span>
                    <select
                        className={styles.configSelect}
                        value={delaySeconds}
                        onChange={e => setDelaySeconds(Number(e.target.value))}
                        disabled={runState === 'running'}
                    >
                        <option value={1}>1s</option>
                        <option value={2}>2s</option>
                        <option value={3}>3s</option>
                        <option value={5}>5s</option>
                    </select>
                </div>
            </div>

            {/* ── File Upload Dropzone (When list is empty) ── */}
            {!entries.length && (
                <div className={styles.uploadZone} onClick={() => fileInputRef.current?.click()}>
                    <UploadIcon />
                    <span className={styles.uploadText}>Drop Lead List Here or Click to Browse</span>
                    <span className={styles.uploadHint}>
                        Upload Excel (.xlsx, .xls) or CSV with phone numbers and lead names. Auto-detects columns automatically!
                    </span>
                    <div className={styles.supportedBadges}>
                        <span>.XLSX</span>
                        <span>.XLS</span>
                        <span>.CSV</span>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className={styles.fileInput}
                        onChange={e => {
                            if (e.target.files?.[0]) parseFile(e.target.files[0]);
                        }}
                    />
                </div>
            )}

            {/* ── Campaign Control Bar ── */}
            {entries.length > 0 && (
                <div className={styles.controls}>
                    {runState === 'idle' && (
                        <button className={`${styles.btn} ${styles.btnStart}`} onClick={handleStart}>
                            ▶ Start Campaign ({entries.length} Leads)
                        </button>
                    )}

                    {runState === 'running' && (
                        <>
                            <button className={`${styles.btn} ${styles.btnPause}`} onClick={handlePause}>
                                ⏸ Pause
                            </button>
                            <button className={`${styles.btn} ${styles.btnStop}`} onClick={handleStopAll}>
                                ⏹ Stop All Calls
                            </button>
                        </>
                    )}

                    {runState === 'paused' && (
                        <>
                            <button className={`${styles.btn} ${styles.btnStart}`} onClick={handleResume}>
                                ▶ Resume Campaign
                            </button>
                            <button className={`${styles.btn} ${styles.btnStop}`} onClick={handleStopAll}>
                                ⏹ Stop All Calls
                            </button>
                        </>
                    )}

                    {runState === 'done' && (
                        <span className={styles.doneTag}>✅ Campaign Complete</span>
                    )}

                    {(stats.failed > 0 || stats.noAnswer > 0 || stats.voicemail > 0) && runState !== 'running' && (
                        <button className={`${styles.btn} ${styles.btnRetry}`} onClick={handleRetryFailed}>
                            🔄 Retry Incomplete ({stats.failed + stats.noAnswer + stats.voicemail})
                        </button>
                    )}

                    <button className={`${styles.btn} ${styles.btnUpload}`} onClick={() => fileInputRef.current?.click()}>
                        📂 New File
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className={styles.fileInput}
                        onChange={e => {
                            if (e.target.files?.[0]) parseFile(e.target.files[0]);
                        }}
                    />

                    <button className={`${styles.btn} ${styles.btnClear}`} onClick={handleClear}>
                        ✕ Clear
                    </button>
                </div>
            )}

            {/* ── Lead Rows List & Inspector Split View ── */}
            {entries.length > 0 && (
                <div className={`${styles.listContainer} ${selectedEntry ? styles.listContainerWithInspector : ''}`}>
                    <div className={styles.list}>
                        {entries.map((entry, idx) => {
                            const isActive = entry.status === 'dialing' || entry.status === 'connected' || entry.status === 'transferring';
                            const isSelected = selectedEntryId === entry.id;

                            return (
                                <div
                                    key={entry.id}
                                    className={`${styles.row} ${isActive ? styles.rowActive : ''} ${isSelected ? styles.rowSelected : ''}`}
                                    onClick={() => setSelectedEntryId(entry.id)}
                                >
                                    <span className={styles.rowIndex}>{idx + 1}</span>

                                    <div className={styles.leadDetails}>
                                        <div className={styles.rowHeaderLine}>
                                            <span className={styles.rowNumber}>{entry.number}</span>
                                            {entry.name && <span className={styles.leadName}>({entry.name})</span>}
                                        </div>

                                        {/* Real-time speech preview / note */}
                                        {entry.note && (
                                            <span className={styles.leadNote}>
                                                {entry.note}
                                            </span>
                                        )}
                                    </div>

                                    {/* Status Badge */}
                                    <span className={`${styles.rowBadge} ${styles[`badge_${entry.status.replace('-', '_')}`]}`}>
                                        {entry.status === 'pending' && '⏳ Pending'}
                                        {entry.status === 'queued' && '📋 Queued'}
                                        {entry.status === 'dialing' && '🟡 Ringing...'}
                                        {entry.status === 'connected' && '🟢 In Call'}
                                        {entry.status === 'voicemail' && '📼 Voicemail'}
                                        {entry.status === 'transferring' && '🔔 Transferring!'}
                                        {entry.status === 'completed' && `✅ ${formatDuration(entry.duration)}`}
                                        {entry.status === 'no-answer' && '⭕ No Answer'}
                                        {entry.status === 'busy' && '🔴 Busy'}
                                        {entry.status === 'failed' && '❌ Failed'}
                                        {entry.status === 'cancelled' && '⏹ Cancelled'}
                                        {entry.status === 'skipped' && '⏭ Skipped'}
                                    </span>

                                    {/* Action Buttons */}
                                    <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
                                        {isActive && (
                                            <button
                                                className={`${styles.rowActionBtn} ${styles.rowActionCancel}`}
                                                onClick={() => handleCancelEntry(entry)}
                                                title="Cancel / Hangup this call"
                                            >
                                                Hang Up
                                            </button>
                                        )}
                                        {entry.status === 'pending' && (
                                            <button
                                                className={`${styles.rowActionBtn} ${styles.rowActionSkip}`}
                                                onClick={() => handleSkipEntry(entry.id)}
                                                title="Skip this lead"
                                            >
                                                Skip
                                            </button>
                                        )}
                                        {(entry.status === 'failed' || entry.status === 'no-answer' || entry.status === 'voicemail' || entry.status === 'cancelled') && (
                                            <button
                                                className={`${styles.rowActionBtn} ${styles.rowActionRetry}`}
                                                onClick={() => dialEntry(entry.id)}
                                                title="Redial this lead now"
                                            >
                                                Redial
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Live Transcript Inspector Drawer ── */}
                    {selectedEntry && (
                        <div className={styles.inspector}>
                            <div className={styles.inspectorHeader}>
                                <span className={styles.inspectorTitle}>🎙️ LIVE CALL INSPECTOR</span>
                                <button className={styles.inspectorClose} onClick={() => setSelectedEntryId(null)}>×</button>
                            </div>

                            <div className={styles.inspectorMeta}>
                                <span className={styles.inspectorPhone}>{selectedEntry.number}</span>
                                {selectedEntry.name && <span className={styles.inspectorLeadName}>{selectedEntry.name}</span>}
                                <div className={styles.inspectorStatusRow}>
                                    <span className={`${styles.rowBadge} ${styles[`badge_${selectedEntry.status.replace('-', '_')}`]}`}>
                                        {selectedEntry.status.toUpperCase()}
                                    </span>
                                    {selectedEntry.duration !== undefined && selectedEntry.duration > 0 && (
                                        <span className={styles.leadNote}>Duration: {formatDuration(selectedEntry.duration)}</span>
                                    )}
                                </div>
                            </div>

                            <div className={styles.inspectorTurns}>
                                {selectedEntry.turns && selectedEntry.turns.length > 0 ? (
                                    selectedEntry.turns.map((turn, i) => (
                                        <div
                                            key={i}
                                            className={`${styles.turnBubble} ${turn.role === 'user' ? styles.turnUser : styles.turnAssistant}`}
                                        >
                                            <div className={styles.turnRole}>
                                                {turn.role === 'user' ? '👤 Customer' : '🤖 AI Agent (Ashley)'}
                                            </div>
                                            <div>{turn.text}</div>
                                        </div>
                                    ))
                                ) : (
                                    <div className={styles.noTurns}>
                                        {selectedEntry.status === 'dialing'
                                            ? '🟡 Customer phone is ringing... AI will begin speaking upon answer.'
                                            : selectedEntry.status === 'pending'
                                            ? '⏳ Waiting in queue to be dialed.'
                                            : selectedEntry.note || 'No transcript turns recorded yet.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function UploadIcon() {
    return (
        <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
    );
}
