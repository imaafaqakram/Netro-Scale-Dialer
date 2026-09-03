'use client';

import React from 'react';
import type { CallHistoryEntry, CallHistoryFilter } from '@/types';
import styles from './CallHistoryList.module.css';

interface CallHistoryListProps {
    entries: CallHistoryEntry[];
    filter: CallHistoryFilter | string;
    onFilterChange: (filter: CallHistoryFilter) => void;
    onCall: (phoneNumber: string) => void;
    onClear: () => void;
    onDelete?: (id: string) => void;
    hideFilters?: boolean;
}

const STATUS_LABELS: Partial<Record<CallHistoryEntry['status'], string>> = {
    missed: 'Missed',
    'no-answer': 'No Answer',
    busy: 'Busy',
    failed: 'Failed',
    canceled: 'Canceled',
    voicemail: 'Voicemail',
    'in-progress': 'In Progress',
};

const filterOptions: { value: CallHistoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'incoming', label: 'Incoming' },
    { value: 'outgoing', label: 'Outgoing' },
    { value: 'missed', label: 'Missed' },
];

export function CallHistoryList({ entries, filter, onFilterChange, onCall, onClear, onDelete, hideFilters = false }: CallHistoryListProps) {
    const formatDuration = (seconds: number): string => {
        if (seconds === 0) return 'No answer';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins === 0) return `${secs}s`;
        return `${mins}m ${secs}s`;
    };

    const formatTimestamp = (date: Date): string => {
        const now = new Date();
        const timestamp = new Date(date);
        const diff = now.getTime() - timestamp.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return 'Yesterday ' + timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (days < 7) {
            return timestamp.toLocaleDateString([], { weekday: 'short' }) + ' ' +
                timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const getInitials = (phoneNumber: string): string => {
        // Simple hashing to generate consistent initials
        const hash = phoneNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        return letters[hash % 26] + letters[(hash * 7) % 26];
    };

    const getAvatarColor = (phoneNumber: string): string => {
        const colors = [
            'linear-gradient(135deg, #6366f1, #4f46e5)',
            'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            'linear-gradient(135deg, #ec4899, #db2777)',
            'linear-gradient(135deg, #f97316, #ea580c)',
            'linear-gradient(135deg, #10b981, #059669)',
            'linear-gradient(135deg, #3b82f6, #2563eb)',
        ];
        const hash = phoneNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[hash % colors.length];
    };

    return (
        <div className={styles.container}>
            {/* Filters - only show if not hidden */}
            {!hideFilters && (
                <div className={styles.filters}>
                    <div className={styles.filterTabs} role="tablist">
                        {filterOptions.map((option) => (
                            <button
                                key={option.value}
                                className={`${styles.filterTab} ${filter === option.value ? styles.active : ''}`}
                                onClick={() => onFilterChange(option.value)}
                                role="tab"
                                aria-selected={filter === option.value}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    {entries.length > 0 && (
                        <button className={styles.clearBtn} onClick={onClear}>
                            Clear All
                        </button>
                    )}
                </div>
            )}

            {/* Clear button when filters hidden but has entries */}
            {hideFilters && entries.length > 0 && (
                <div className={styles.filtersMinimal}>
                    <button className={styles.clearBtn} onClick={onClear}>
                        Clear All
                    </button>
                </div>
            )}

            {/* List */}
            {entries.length === 0 ? (
                <div className="empty-state">
                    <PhoneIcon />
                    <h3>No calls yet</h3>
                    <p>Your call history will appear here. Use the dialer below to make your first call.</p>
                </div>
            ) : (
                <div className={styles.list}>
                    {entries.map((entry) => (
                        <div key={entry.id} className={styles.card}>
                            <div
                                className={styles.avatar}
                                style={{ background: getAvatarColor(entry.phoneNumber) }}
                            >
                                {getInitials(entry.phoneNumber)}
                            </div>

                            <div className={styles.info}>
                                <div className={styles.number}>{entry.phoneNumber}</div>
                                <div className={styles.meta}>
                                    <span className={`${styles.direction} ${styles[entry.direction]}`}>
                                        {entry.direction === 'incoming' ? <IncomingIcon /> : <OutgoingIcon />}
                                        {entry.direction}
                                    </span>
                                    <span className={styles.dot}>•</span>
                                    <span className={styles.time}>{formatTimestamp(entry.timestamp)}</span>
                                </div>
                            </div>

                            <div className={styles.right}>
                                {entry.status in STATUS_LABELS ? (
                                    <span className={`${styles.badge} ${styles.missed}`}>
                                        {STATUS_LABELS[entry.status]}
                                    </span>
                                ) : (
                                    <span className={styles.duration}>{formatDuration(entry.duration)}</span>
                                )}

                                <button
                                    className={styles.callBtn}
                                    onClick={() => onCall(entry.phoneNumber)}
                                    aria-label={`Call ${entry.phoneNumber}`}
                                    title="Call again"
                                >
                                    <CallIcon />
                                </button>

                                {onDelete && (
                                    <button
                                        className={styles.deleteBtn}
                                        onClick={() => onDelete(entry.id)}
                                        aria-label={`Delete call with ${entry.phoneNumber} from history`}
                                        title="Delete from history"
                                    >
                                        <DeleteIcon />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// Icons
function PhoneIcon() {
    return (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function IncomingIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
        </svg>
    );
}

function OutgoingIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 18 10.5 8.5 15.5 13.5 23 6" />
            <polyline points="17 6 23 6 23 12" />
        </svg>
    );
}

function CallIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
        </svg>
    );
}

function DeleteIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}
