// Call types
export type CallDirection = 'incoming' | 'outgoing';
export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'disconnected';

export interface CallInfo {
    direction: CallDirection;
    phoneNumber: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    status: CallStatus;
}

// Call history types — mirrors call_history rows (see
// supabase-migration-003-call-history.sql), written server-side from Twilio's own
// call status callbacks. 'missed' covers no-answer/busy/failed/canceled on an
// incoming call; those same outcomes on an outgoing call keep their specific
// status so "I called and it rang out" reads differently from "I called and the
// line was busy."
export type CallOutcomeStatus =
    | 'in-progress'
    | 'completed'
    | 'missed'
    | 'no-answer'
    | 'busy'
    | 'failed'
    | 'canceled'
    | 'voicemail';

export interface CallHistoryEntry {
    id: string;
    callSid?: string;
    direction: CallDirection;
    phoneNumber: string;
    leadName?: string | null;
    callMode?: 'direct' | 'script' | 'ai_agent';
    timestamp: Date;
    duration: number; // in seconds
    status: CallOutcomeStatus;
}

export type CallHistoryFilter = 'all' | 'incoming' | 'outgoing' | 'missed';

// Device status
export type DeviceStatus = 'offline' | 'connecting' | 'ready' | 'busy' | 'error';

// Accessibility preferences
export interface AccessibilityPreferences {
    theme: 'light' | 'dark' | 'system';
    fontSize: 'small' | 'normal' | 'large' | 'extra-large';
    highContrast: boolean;
    reducedMotion: boolean;
}

// Audio settings
export interface AudioDevice {
    deviceId: string;
    label: string;
}
