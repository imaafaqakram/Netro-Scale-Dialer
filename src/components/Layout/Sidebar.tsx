'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

interface SidebarProps {
    callFilter?: string;
    onCallFilterChange?: (filter: any) => void;
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const pathname = usePathname();
    const [unreadVoicemails, setUnreadVoicemails] = useState(0);
    const [defaultNumber, setDefaultNumber] = useState<string>('');
    const [canSeeAdmin, setCanSeeAdmin] = useState(false);
    const [canSeeSuperAdmin, setCanSeeSuperAdmin] = useState(false);

    // Fetch real unread voicemails and default caller ID
    useEffect(() => {
        const fetchMetadata = async () => {
            try {
                // Fetch unread voicemails
                const recRes = await fetch('/api/user/recordings?type=voicemail');
                if (recRes.ok) {
                    const data = await recRes.json();
                    setUnreadVoicemails(data.unreadVoicemails || 0);
                }

                // Fetch default caller ID number
                const numRes = await fetch('/api/user/numbers');
                if (numRes.ok) {
                    const data = await numRes.json();
                    if (data.numbers && data.numbers.length > 0) {
                        const def = data.numbers.find((n: any) => n.is_default) || data.numbers[0];
                        setDefaultNumber(def.phone_number || '');
                    }
                }

                // Fetch role, to decide whether to show Admin / Super Admin links.
                // The links are just visibility — every /admin and /superadmin
                // route re-checks authorization itself server-side regardless.
                const roleRes = await fetch('/api/user/role');
                if (roleRes.ok) {
                    const data = await roleRes.json();
                    setCanSeeAdmin(!!data.isSuperAdmin || data.orgRole === 'org_admin');
                    setCanSeeSuperAdmin(!!data.isSuperAdmin);
                }
            } catch { }
        };

        fetchMetadata();
        const interval = setInterval(fetchMetadata, 30000);
        return () => clearInterval(interval);
    }, []);

    const isDialerPage = pathname === '/' || pathname === '/calls' || pathname.startsWith('/calls/');
    const isRecordingsPage = pathname === '/recordings' || pathname.startsWith('/recordings/');
    const isSettingsPage = pathname === '/settings' || pathname.startsWith('/settings/');
    const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
    const isSuperAdminPage = pathname === '/superadmin' || pathname.startsWith('/superadmin/');

    return (
        <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
            {/* Netro Scale Logo Header */}
            <div className={styles.brandHeader}>
                <div className={styles.brandLogo}>
                    <NetroScaleLogoIcon />
                </div>
                <div className={styles.brandInfo}>
                    <span className={styles.brandName}>Netro Scale</span>
                    <span className={styles.brandTag}>VoIP Phone System</span>
                </div>
            </div>

            {/* Navigation Menu (Legit Working Backend Features Only) */}
            <nav className={styles.nav}>
                <div className={styles.navList}>
                    <Link
                        href="/"
                        className={`${styles.navItem} ${isDialerPage ? styles.active : ''}`}
                    >
                        <PhoneIcon />
                        <span className={styles.navLabel}>Phone Dialer</span>
                        <span className={styles.liveTag}>LIVE</span>
                    </Link>

                    <Link
                        href="/recordings"
                        className={`${styles.navItem} ${isRecordingsPage ? styles.active : ''}`}
                    >
                        <RecordingIcon />
                        <span className={styles.navLabel}>Recordings & Voicemail</span>
                        {unreadVoicemails > 0 && (
                            <span className={styles.badge}>{unreadVoicemails}</span>
                        )}
                    </Link>

                    <Link
                        href="/settings"
                        className={`${styles.navItem} ${isSettingsPage ? styles.active : ''}`}
                    >
                        <SettingsIcon />
                        <span className={styles.navLabel}>Settings & Numbers</span>
                    </Link>

                    {canSeeAdmin && (
                        <Link
                            href="/admin"
                            className={`${styles.navItem} ${isAdminPage ? styles.active : ''}`}
                        >
                            <AdminIcon />
                            <span className={styles.navLabel}>Admin</span>
                        </Link>
                    )}

                    {canSeeSuperAdmin && (
                        <Link
                            href="/superadmin"
                            className={`${styles.navItem} ${isSuperAdminPage ? styles.active : ''}`}
                        >
                            <SuperAdminIcon />
                            <span className={styles.navLabel}>Super Admin</span>
                        </Link>
                    )}
                </div>
            </nav>

            {/* Sidebar Bottom: Active Line Info */}
            <div className={styles.sidebarFooter}>
                <div className={styles.activeLineCard}>
                    <div className={styles.lineHeader}>
                        <span className={styles.lineDot} />
                        <span className={styles.lineTitle}>Active Caller ID</span>
                    </div>
                    <div className={styles.lineNumber}>
                        {defaultNumber || 'Twilio Default Line'}
                    </div>
                </div>
            </div>
        </aside>
    );
}

// Icons
function NetroScaleLogoIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M4 19V5L12 13L20 5V19"
                stroke="white"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="12" cy="18.5" r="2" fill="#10B981" />
        </svg>
    );
}

function PhoneIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function RecordingIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
    );
}

function AdminIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}

function SuperAdminIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
            <path d="M9 12l2 2 4-4" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}
