'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { AccessibilityPreferences } from '@/types';

const STORAGE_KEY = 'twilio-phone-accessibility';

const defaultPreferences: AccessibilityPreferences = {
    theme: 'system',
    fontSize: 'normal',
    highContrast: false,
    reducedMotion: false,
};

interface AccessibilityContextValue {
    preferences: AccessibilityPreferences;
    setTheme: (theme: AccessibilityPreferences['theme']) => void;
    setFontSize: (size: AccessibilityPreferences['fontSize']) => void;
    setHighContrast: (enabled: boolean) => void;
    setReducedMotion: (enabled: boolean) => void;
    resetPreferences: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

// A Context, not a plain hook, deliberately: every screen that reads or writes theme/font
// preferences (the Accessibility panel, Settings → Appearance, and any future control) must
// share one live copy of state. A plain hook re-instantiated per component only agrees with
// localStorage at that component's own mount time — e.g. changing theme in Settings would
// silently fail to update the Accessibility panel until a full page reload.
export function AccessibilityProvider({ children }: { children: ReactNode }) {
    const [preferences, setPreferences] = useState<AccessibilityPreferences>(defaultPreferences);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setPreferences({ ...defaultPreferences, ...JSON.parse(stored) });
            }
        } catch (err) {
            console.error('Failed to load accessibility preferences:', err);
        }
    }, []);

    useEffect(() => {
        const root = document.documentElement;

        let effectiveTheme = preferences.theme;
        if (preferences.theme === 'system') {
            effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        root.setAttribute('data-theme', effectiveTheme);
        root.setAttribute('data-font-size', preferences.fontSize);
        root.setAttribute('data-high-contrast', String(preferences.highContrast));
        root.setAttribute('data-reduced-motion', String(preferences.reducedMotion));
    }, [preferences]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            if (preferences.theme === 'system') {
                document.documentElement.setAttribute('data-theme', mediaQuery.matches ? 'dark' : 'light');
            }
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [preferences.theme]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
        } catch (err) {
            console.error('Failed to save accessibility preferences:', err);
        }
    }, [preferences]);

    const setTheme = useCallback((theme: AccessibilityPreferences['theme']) => {
        setPreferences((prev) => ({ ...prev, theme }));
    }, []);

    const setFontSize = useCallback((fontSize: AccessibilityPreferences['fontSize']) => {
        setPreferences((prev) => ({ ...prev, fontSize }));
    }, []);

    const setHighContrast = useCallback((highContrast: boolean) => {
        setPreferences((prev) => ({ ...prev, highContrast }));
    }, []);

    const setReducedMotion = useCallback((reducedMotion: boolean) => {
        setPreferences((prev) => ({ ...prev, reducedMotion }));
    }, []);

    const resetPreferences = useCallback(() => {
        setPreferences(defaultPreferences);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const value: AccessibilityContextValue = {
        preferences,
        setTheme,
        setFontSize,
        setHighContrast,
        setReducedMotion,
        resetPreferences,
    };

    return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): AccessibilityContextValue {
    const context = useContext(AccessibilityContext);
    if (!context) {
        throw new Error('useAccessibility must be used within an AccessibilityProvider');
    }
    return context;
}
