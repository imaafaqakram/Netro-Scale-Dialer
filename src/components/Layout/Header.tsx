'use client';

import React, { useState } from 'react';
import { UserMenu } from './UserMenu';
import styles from './Header.module.css';

interface HeaderProps {
    onAccessibilityClick?: () => void;
    callFilter?: string;
    deviceStatus?: 'offline' | 'connecting' | 'ready' | 'busy' | 'error';
    error?: string | null;
    user?: { email?: string | null };
    onMenuToggle?: () => void;
}

export function Header({ deviceStatus = 'ready', error, user, onMenuToggle }: HeaderProps) {
    const [balance, setBalance] = useState(25.00);
    const [showTopUpModal, setShowTopUpModal] = useState(false);
    const [selectedAmount, setSelectedAmount] = useState(10);
    const [showStatusTooltip, setShowStatusTooltip] = useState(false);

    const handleAddFunds = (amount: number) => {
        setBalance(prev => prev + amount);
        setShowTopUpModal(false);
    };

    return (
        <header className={styles.header}>
            {/* Left: Hamburger (mobile) + View title */}
            <div className={styles.left}>
                {onMenuToggle && (
                    <button
                        className={styles.hamburgerBtn}
                        onClick={onMenuToggle}
                        aria-label="Toggle sidebar menu"
                        title="Menu"
                    >
                        <HamburgerIcon />
                    </button>
                )}
                <div className={styles.titleWrapper}>
                    <h1 className={styles.title}>Phone Dialer</h1>
                    <span className={styles.subtitle}>WebRTC Cloud Calling Suite</span>
                </div>
            </div>

            {/* Right: Actions, Balance, and Status */}
            <div className={styles.right}>
                {/* Balance Widget */}
                <div className={styles.balanceWidget}>
                    <div className={styles.balanceInfo}>
                        <span className={styles.balanceLabel}>Balance</span>
                        <span className={styles.balanceAmount}>${balance.toFixed(2)}</span>
                    </div>
                    <button
                        className={styles.topUpBtn}
                        onClick={() => setShowTopUpModal(true)}
                        title="Add calling credits"
                    >
                        + Top Up
                    </button>
                </div>

                {/* Connection Status */}
                <div className={styles.statusWrapper}>
                    <button
                        className={`${styles.statusPill} ${styles[deviceStatus]}`}
                        onClick={() => setShowStatusTooltip(!showStatusTooltip)}
                        title={error || 'Device Status'}
                    >
                        <span className={styles.statusDot} />
                        <span className={styles.statusText}>
                            {deviceStatus === 'ready' ? 'Ready' : deviceStatus === 'busy' ? 'On Call' : deviceStatus === 'connecting' ? 'Connecting' : 'Offline'}
                        </span>
                    </button>

                    {showStatusTooltip && (
                        <div className={styles.statusTooltip}>
                            <div className={styles.tooltipHeader}>
                                <span>VoIP Line Status</span>
                                <button onClick={() => setShowStatusTooltip(false)}>×</button>
                            </div>
                            <div className={styles.tooltipBody}>
                                <p><strong>Status:</strong> {deviceStatus === 'ready' ? 'Connected (Ready to dial)' : deviceStatus}</p>
                                {error && <p className={styles.errorText}>{error}</p>}
                            </div>
                        </div>
                    )}
                </div>

                {/* User Menu */}
                <UserMenu user={user} />
            </div>

            {/* Top Up Modal */}
            {showTopUpModal && (
                <div className={styles.modalBackdrop} onClick={() => setShowTopUpModal(false)}>
                    <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>Recharge Account Balance</h3>
                            <button className={styles.modalClose} onClick={() => setShowTopUpModal(false)}>×</button>
                        </div>
                        <div className={styles.modalBody}>
                            <p className={styles.modalDesc}>Current calling balance: <strong>${balance.toFixed(2)}</strong></p>
                            <label className={styles.amountLabel}>Choose Top-Up Amount:</label>
                            <div className={styles.amountGrid}>
                                {[10, 25, 50, 100].map(amt => (
                                    <button
                                        key={amt}
                                        className={`${styles.amountOption} ${selectedAmount === amt ? styles.amountSelected : ''}`}
                                        onClick={() => setSelectedAmount(amt)}
                                    >
                                        ${amt}.00
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.cancelBtn} onClick={() => setShowTopUpModal(false)}>Cancel</button>
                            <button className={styles.confirmBtn} onClick={() => handleAddFunds(selectedAmount)}>Add ${selectedAmount}.00</button>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
}

function HamburgerIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
    );
}
