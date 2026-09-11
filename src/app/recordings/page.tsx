'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/Layout';
import { createClient } from '@/lib/supabase';
import { useSignalWire } from '@/contexts/SignalWireContext';
import styles from './page.module.css';

interface Recording {
    id: string;
    user_id: string;
    phone_number: string;
    caller_number: string;
    recording_url: string;
    recording_sid: string;
    call_sid: string;
    duration: number;
    recording_type: 'call' | 'voicemail';
    is_read: boolean;
    created_at: string;
}

type TabType = 'call' | 'voicemail';

function RecordingsContent() {
    const searchParams = useSearchParams();
    const tabFromUrl = searchParams.get('tab') as TabType | null;
    const signalwire = useSignalWire();

    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [activeTab, setActiveTab] = useState<TabType>(tabFromUrl === 'call' ? 'call' : 'voicemail');
    const [loading, setLoading] = useState(true);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [progress, setProgress] = useState<Record<string, number>>({});
    const [user, setUser] = useState<{ email?: string | null } | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Sync tab from URL when navigating via sidebar
    useEffect(() => {
        if (tabFromUrl === 'call' || tabFromUrl === 'voicemail') {
            setActiveTab(tabFromUrl);
        }
    }, [tabFromUrl]);

    // Fetch user session
    useEffect(() => {
        const fetchUser = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        };
        fetchUser();
    }, []);

    // Fetch recordings
    const fetchRecordings = useCallback(async () => {
        try {
            const res = await fetch(`/api/user/recordings?type=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setRecordings(data.recordings || []);
                setUnreadCount(data.unreadVoicemails || 0);
            }
        } catch (err) {
            console.error('Failed to fetch recordings:', err);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        setLoading(true);
        fetchRecordings();
    }, [fetchRecordings]);

    // Audio playback (uses proxy to avoid SignalWire auth issues)
    const handlePlay = async (recording: Recording) => {
        // Stop current playback
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        if (playingId === recording.id) {
            setPlayingId(null);
            return;
        }

        // Use our proxy route which adds SignalWire auth
        const audioUrl = `/api/user/recordings/audio?url=${encodeURIComponent(recording.recording_url)}`;

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        setPlayingId(recording.id);

        // Mark as read if voicemail
        if (recording.recording_type === 'voicemail' && !recording.is_read) {
            await fetch('/api/user/recordings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: recording.id }),
            });
            setRecordings(prev =>
                prev.map(r => r.id === recording.id ? { ...r, is_read: true } : r)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        }

        audio.addEventListener('timeupdate', () => {
            if (audio.duration) {
                setProgress(prev => ({ ...prev, [recording.id]: (audio.currentTime / audio.duration) * 100 }));
            }
        });

        audio.addEventListener('ended', () => {
            setPlayingId(null);
            setProgress(prev => ({ ...prev, [recording.id]: 0 }));
            audioRef.current = null;
        });

        audio.play().catch(err => {
            console.error('Playback error:', err);
            setPlayingId(null);
        });
    };

    // Delete recording
    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/user/recordings?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                if (playingId === id && audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current = null;
                    setPlayingId(null);
                }
                setRecordings(prev => prev.filter(r => r.id !== id));
            }
        } catch (err) {
            console.error('Failed to delete recording:', err);
        }
    };

    // Seek
    const handleSeek = (recordingId: string, e: React.MouseEvent<HTMLDivElement>) => {
        if (playingId !== recordingId || !audioRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audioRef.current.currentTime = pct * audioRef.current.duration;
    };

    // Format helpers
    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const today = now.toDateString() === d.toDateString();
        if (today) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <AppLayout
            deviceStatus={signalwire.deviceStatus}
            error={signalwire.deviceError}
            user={user || undefined}
        >
            <div className={styles.container}>
                {/* Tabs */}
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'voicemail' ? styles.active : ''}`}
                        onClick={() => setActiveTab('voicemail')}
                    >
                        <VoicemailIcon />
                        Voicemails
                        {unreadCount > 0 && (
                            <span className={styles.tabBadge}>{unreadCount}</span>
                        )}
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'call' ? styles.active : ''}`}
                        onClick={() => setActiveTab('call')}
                    >
                        <RecordIcon />
                        Call Recordings
                    </button>
                </div>

                {/* Content */}
                <div className={styles.content}>
                    {loading ? (
                        <div className={styles.loading}>Loading recordings...</div>
                    ) : recordings.length === 0 ? (
                        <div className={styles.emptyState}>
                            {activeTab === 'voicemail' ? <VoicemailIcon /> : <RecordIcon />}
                            <h3>No {activeTab === 'voicemail' ? 'voicemails' : 'recordings'} yet</h3>
                            <p>
                                {activeTab === 'voicemail'
                                    ? 'When callers leave voicemails, they will appear here.'
                                    : 'Enable call recording in Settings to start recording calls.'}
                            </p>
                        </div>
                    ) : (
                        <div className={styles.recordingList}>
                            {recordings.map(recording => (
                                <div
                                    key={recording.id}
                                    className={`${styles.recordingCard} ${!recording.is_read && recording.recording_type === 'voicemail' ? styles.unread : ''}`}
                                >
                                    {/* Icon */}
                                    <div className={`${styles.recordingIcon} ${recording.recording_type === 'voicemail' ? styles.voicemail : styles.call}`}>
                                        {recording.recording_type === 'voicemail' ? <VoicemailIcon /> : <RecordIcon />}
                                    </div>

                                    {/* Info */}
                                    <div className={styles.recordingInfo}>
                                        <div className={styles.recordingCaller}>
                                            {recording.caller_number || recording.phone_number || 'Unknown'}
                                        </div>
                                        <div className={styles.recordingMeta}>
                                            <span>{formatDate(recording.created_at)}</span>
                                            <span className={styles.dot} />
                                            <span>{formatDuration(recording.duration)}</span>
                                        </div>
                                    </div>

                                    {/* Audio Player */}
                                    <div className={styles.audioPlayer}>
                                        <button
                                            className={styles.playBtn}
                                            onClick={() => handlePlay(recording)}
                                            title={playingId === recording.id ? 'Pause' : 'Play'}
                                        >
                                            {playingId === recording.id ? <PauseIcon /> : <PlayIcon />}
                                        </button>
                                        <div className={styles.progressWrapper}>
                                            <div
                                                className={styles.progressBar}
                                                onClick={(e) => handleSeek(recording.id, e)}
                                            >
                                                <div
                                                    className={styles.progressFill}
                                                    style={{ width: `${progress[recording.id] || 0}%` }}
                                                />
                                            </div>
                                            <span className={styles.progressTime}>
                                                {formatDuration(recording.duration)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <button
                                        className={styles.deleteBtn}
                                        onClick={() => handleDelete(recording.id)}
                                        title="Delete recording"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

// Wrap with Suspense because useSearchParams requires it
export default function RecordingsPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <RecordingsContent />
        </Suspense>
    );
}

// Icons
function VoicemailIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5.5" cy="11.5" r="4.5" />
            <circle cx="18.5" cy="11.5" r="4.5" />
            <line x1="5.5" y1="16" x2="18.5" y2="16" />
        </svg>
    );
}

function RecordIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}
