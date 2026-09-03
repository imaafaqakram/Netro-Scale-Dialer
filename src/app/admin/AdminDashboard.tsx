'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/Layout';
import styles from './admin.module.css';

interface Member {
    userId: string;
    email: string;
    role: 'org_admin' | 'agent';
    createdAt: string;
}

interface OrgNumber {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    is_default: boolean;
    user_id: string;
    call_recording_enabled: boolean;
    voicemail_enabled: boolean;
}

export function AdminDashboard({ orgRole }: { orgRole: 'org_admin' | 'agent' }) {
    const [members, setMembers] = useState<Member[]>([]);
    const [numbers, setNumbers] = useState<OrgNumber[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'agent' | 'org_admin'>('agent');
    const [inviting, setInviting] = useState(false);

    const [newNumber, setNewNumber] = useState('');
    const [newNumberName, setNewNumberName] = useState('');
    const [newNumberAssignee, setNewNumberAssignee] = useState('');
    const [addingNumber, setAddingNumber] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [membersRes, numbersRes] = await Promise.all([
                fetch('/api/admin/members'),
                fetch('/api/admin/numbers'),
            ]);
            const membersData = await membersRes.json();
            const numbersData = await numbersRes.json();
            if (!membersRes.ok) throw new Error(membersData.error || 'Failed to load members');
            if (!numbersRes.ok) throw new Error(numbersData.error || 'Failed to load numbers');
            setMembers(membersData.members || []);
            setNumbers(numbersData.numbers || []);
        } catch (e: any) {
            setError(e.message || 'Failed to load organization data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to invite user');
            setInviteEmail('');
            setInviteRole('agent');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to invite user');
        } finally {
            setInviting(false);
        }
    };

    const handleRoleChange = async (userId: string, role: 'org_admin' | 'agent') => {
        setError(null);
        try {
            const res = await fetch(`/api/admin/members/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update role');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to update role');
        }
    };

    const handleRemove = async (userId: string, email: string) => {
        if (!confirm(`Remove ${email} from this organization? They will lose access immediately.`)) return;
        setError(null);
        try {
            const res = await fetch(`/api/admin/members/${userId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove member');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to remove member');
        }
    };

    const handleAddNumber = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newNumber.trim() || !newNumberAssignee) return;
        setAddingNumber(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: newNumber.trim(), friendlyName: newNumberName.trim(), userId: newNumberAssignee }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add number');
            setNewNumber('');
            setNewNumberName('');
            setNewNumberAssignee('');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to add number');
        } finally {
            setAddingNumber(false);
        }
    };

    const handleReassignNumber = async (numberId: string, userId: string) => {
        setError(null);
        try {
            const res = await fetch('/api/admin/numbers', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: numberId, userId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to reassign number');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to reassign number');
        }
    };

    const emailFor = (userId: string) => members.find((m) => m.userId === userId)?.email || userId;

    return (
        <AppLayout>
            <div className={styles.page}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Organization Admin</h1>
                    <p className={styles.subtitle}>Manage the users and phone numbers in your organization.</p>
                </div>

                {error && <div className={styles.errorBanner}>{error}</div>}

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Users</h2>

                    {orgRole === 'org_admin' && (
                        <form className={styles.inlineForm} onSubmit={handleInvite}>
                            <input
                                type="email"
                                required
                                placeholder="new.agent@company.com"
                                className={styles.inputField}
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                            />
                            <select className={styles.select} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'agent' | 'org_admin')}>
                                <option value="agent">Agent</option>
                                <option value="org_admin">Org Admin</option>
                            </select>
                            <button type="submit" className={styles.primaryBtn} disabled={inviting}>
                                {inviting ? 'Sending invite…' : 'Invite user'}
                            </button>
                        </form>
                    )}

                    {loading ? (
                        <p className={styles.muted}>Loading…</p>
                    ) : members.length === 0 ? (
                        <p className={styles.muted}>No users yet.</p>
                    ) : (
                        <table className={styles.table}>
                            <thead>
                                <tr><th>Email</th><th>Role</th><th>Joined</th><th /></tr>
                            </thead>
                            <tbody>
                                {members.map((m) => (
                                    <tr key={m.userId}>
                                        <td>{m.email || m.userId}</td>
                                        <td>
                                            {orgRole === 'org_admin' ? (
                                                <select
                                                    className={styles.selectSmall}
                                                    value={m.role}
                                                    onChange={(e) => handleRoleChange(m.userId, e.target.value as 'org_admin' | 'agent')}
                                                >
                                                    <option value="agent">Agent</option>
                                                    <option value="org_admin">Org Admin</option>
                                                </select>
                                            ) : (
                                                <span className={styles.badge}>{m.role === 'org_admin' ? 'Org Admin' : 'Agent'}</span>
                                            )}
                                        </td>
                                        <td>{new Date(m.createdAt).toLocaleDateString()}</td>
                                        <td>
                                            {orgRole === 'org_admin' && (
                                                <button className={styles.dangerBtn} onClick={() => handleRemove(m.userId, m.email)}>Remove</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Phone Numbers</h2>

                    {orgRole === 'org_admin' && (
                        <form className={styles.inlineForm} onSubmit={handleAddNumber}>
                            <input
                                type="text"
                                required
                                placeholder="+13072076444"
                                className={styles.inputField}
                                value={newNumber}
                                onChange={(e) => setNewNumber(e.target.value)}
                            />
                            <input
                                type="text"
                                placeholder="Friendly name (optional)"
                                className={styles.inputField}
                                value={newNumberName}
                                onChange={(e) => setNewNumberName(e.target.value)}
                            />
                            <select className={styles.select} required value={newNumberAssignee} onChange={(e) => setNewNumberAssignee(e.target.value)}>
                                <option value="" disabled>Assign to…</option>
                                {members.map((m) => (
                                    <option key={m.userId} value={m.userId}>{m.email}</option>
                                ))}
                            </select>
                            <button type="submit" className={styles.primaryBtn} disabled={addingNumber}>
                                {addingNumber ? 'Adding…' : 'Add number'}
                            </button>
                        </form>
                    )}

                    {loading ? (
                        <p className={styles.muted}>Loading…</p>
                    ) : numbers.length === 0 ? (
                        <p className={styles.muted}>No numbers yet.</p>
                    ) : (
                        <table className={styles.table}>
                            <thead>
                                <tr><th>Number</th><th>Name</th><th>Assigned To</th><th>Recording</th><th>Voicemail</th></tr>
                            </thead>
                            <tbody>
                                {numbers.map((n) => (
                                    <tr key={n.id}>
                                        <td>{n.phone_number}</td>
                                        <td>{n.friendly_name || '—'}</td>
                                        <td>
                                            {orgRole === 'org_admin' ? (
                                                <select
                                                    className={styles.selectSmall}
                                                    value={n.user_id}
                                                    onChange={(e) => handleReassignNumber(n.id, e.target.value)}
                                                >
                                                    {members.map((m) => (
                                                        <option key={m.userId} value={m.userId}>{m.email}</option>
                                                    ))}
                                                </select>
                                            ) : emailFor(n.user_id)}
                                        </td>
                                        <td>{n.call_recording_enabled ? 'On' : 'Off'}</td>
                                        <td>{n.voicemail_enabled ? 'On' : 'Off'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            </div>
        </AppLayout>
    );
}
