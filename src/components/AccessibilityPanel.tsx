'use client';

import React from 'react';
import { useAccessibility } from '@/contexts/AccessibilityContext';
import styles from './AccessibilityPanel.module.css';

interface AccessibilityPanelProps {
    onClose: () => void;
}

export function AccessibilityPanel({ onClose }: AccessibilityPanelProps) {
    const { preferences, setTheme, setFontSize, setHighContrast, setReducedMotion, resetPreferences } = useAccessibility();

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h3 className={styles.title}>Accessibility</h3>
                <button className={styles.closeButton} onClick={onClose} aria-label="Close">
                    <CloseIcon />
                </button>
            </div>

            <div className={styles.content}>
                {/* Theme */}
                <div className={styles.section}>
                    <label className={styles.label}>Theme</label>
                    <div className={styles.buttonGroup} role="radiogroup" aria-label="Theme selection">
                        {(['light', 'dark', 'system'] as const).map((theme) => (
                            <button
                                key={theme}
                                className={`${styles.optionButton} ${preferences.theme === theme ? styles.active : ''}`}
                                onClick={() => setTheme(theme)}
                                role="radio"
                                aria-checked={preferences.theme === theme}
                            >
                                {theme === 'light' && <SunIcon />}
                                {theme === 'dark' && <MoonIcon />}
                                {theme === 'system' && <ComputerIcon />}
                                <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Font Size */}
                <div className={styles.section}>
                    <label className={styles.label}>Text Size</label>
                    <div className={styles.buttonGroup} role="radiogroup" aria-label="Text size selection">
                        {(['small', 'normal', 'large', 'extra-large'] as const).map((size) => (
                            <button
                                key={size}
                                className={`${styles.optionButton} ${preferences.fontSize === size ? styles.active : ''}`}
                                onClick={() => setFontSize(size)}
                                role="radio"
                                aria-checked={preferences.fontSize === size}
                            >
                                <span style={{ fontSize: size === 'small' ? '12px' : size === 'normal' ? '14px' : size === 'large' ? '16px' : '18px' }}>
                                    A
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* High Contrast */}
                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <label htmlFor="high-contrast" className={styles.label}>High Contrast</label>
                        <button
                            id="high-contrast"
                            className={`${styles.toggle} ${preferences.highContrast ? styles.toggleOn : ''}`}
                            onClick={() => setHighContrast(!preferences.highContrast)}
                            role="switch"
                            aria-checked={preferences.highContrast}
                        >
                            <span className={styles.toggleKnob} />
                        </button>
                    </div>
                </div>

                {/* Reduced Motion */}
                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <label htmlFor="reduced-motion" className={styles.label}>Reduce Motion</label>
                        <button
                            id="reduced-motion"
                            className={`${styles.toggle} ${preferences.reducedMotion ? styles.toggleOn : ''}`}
                            onClick={() => setReducedMotion(!preferences.reducedMotion)}
                            role="switch"
                            aria-checked={preferences.reducedMotion}
                        >
                            <span className={styles.toggleKnob} />
                        </button>
                    </div>
                </div>

                {/* Reset */}
                <button className={styles.resetButton} onClick={resetPreferences}>
                    Reset to Defaults
                </button>
            </div>
        </div>
    );
}

function CloseIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

function SunIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}

function ComputerIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
    );
}
