'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CallHistoryEntry, CallHistoryFilter } from '@/types';

// Server-backed call history. Every entry is written by Twilio's own call status
// callbacks (src/app/api/twilio/call-status/route.ts,
// src/app/api/twilio/ai-call/status/route.ts) via /api/user/call-history — this
// hook only reads and deletes. Nothing here caps or expires entries; a row exists
// until the user explicitly deletes it.
const POLL_INTERVAL_MS = 10000;

interface UseCallHistoryReturn {
    history: CallHistoryEntry[];
    filteredHistory: CallHistoryEntry[];
    filter: CallHistoryFilter;
    setFilter: (filter: CallHistoryFilter) => void;
    loading: boolean;
    refresh: () => Promise<void>;
    deleteEntry: (id: string) => Promise<void>;
    clearHistory: () => Promise<void>;
    getEntryById: (id: string) => CallHistoryEntry | undefined;
}

interface ApiEntry {
    id: string;
    callSid?: string;
    direction: CallHistoryEntry['direction'];
    phoneNumber: string;
    leadName?: string | null;
    callMode?: CallHistoryEntry['callMode'];
    status: CallHistoryEntry['status'];
    duration: number;
    timestamp: string;
}

export function useCallHistory(): UseCallHistoryReturn {
    const [history, setHistory] = useState<CallHistoryEntry[]>([]);
    const [filter, setFilter] = useState<CallHistoryFilter>('all');
    const [loading, setLoading] = useState(true);
    const isMounted = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/user/call-history');
            if (!res.ok) return;
            const data = await res.json();
            if (!isMounted.current || !Array.isArray(data.entries)) return;
            setHistory(
                data.entries.map((entry: ApiEntry) => ({
                    ...entry,
                    timestamp: new Date(entry.timestamp),
                }))
            );
        } catch (err) {
            console.error('Failed to load call history:', err);
        } finally {
            if (isMounted.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        isMounted.current = true;
        refresh();
        const interval = setInterval(refresh, POLL_INTERVAL_MS);
        return () => {
            isMounted.current = false;
            clearInterval(interval);
        };
    }, [refresh]);

    const deleteEntry = useCallback(async (id: string) => {
        setHistory((prev) => prev.filter((e) => e.id !== id));
        try {
            await fetch(`/api/user/call-history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (err) {
            console.error('Failed to delete call history entry:', err);
            refresh();
        }
    }, [refresh]);

    const clearHistory = useCallback(async () => {
        setHistory([]);
        try {
            await fetch('/api/user/call-history?all=true', { method: 'DELETE' });
        } catch (err) {
            console.error('Failed to clear call history:', err);
            refresh();
        }
    }, [refresh]);

    const getEntryById = useCallback((id: string) => {
        return history.find((entry) => entry.id === id);
    }, [history]);

    const filteredHistory = history.filter((entry) => {
        switch (filter) {
            case 'incoming':
                return entry.direction === 'incoming';
            case 'outgoing':
                return entry.direction === 'outgoing';
            case 'missed':
                return entry.status === 'missed';
            default:
                return true;
        }
    });

    return {
        history,
        filteredHistory,
        filter,
        setFilter,
        loading,
        refresh,
        deleteEntry,
        clearHistory,
        getEntryById,
    };
}
