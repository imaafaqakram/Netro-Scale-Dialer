'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/Layout';
import styles from '../admin/admin.module.css';

interface Org {
    id: string;
    name: string;
    suspended: boolean;
    createdAt: string;
    memberCount: number;
}

interface Member {
    userId: string;
    email: string;
    role: 'org_admin' | 'agent';
    createdAt: string;
}

export function SuperAdminDashboard() {
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [newOrgName, setNewOrgName] = useState('');
    const [newOrgAdminEmail, setNewOrgAdminEmail] = useState('');
    const [creating, setCreating] = useState(false);

    const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
    const [expandedMembers, setExpandedMembers] = useState<Member[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/superadmin/organizations');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load organizations');
            setOrgs(data.organizations || []);
        } catch (e: any) {
            setError(e.message || 'Failed to load organizations');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newOrgName.trim() || !newOrgAdminEmail.trim()) return;
        setCreating(true);
        setError(null);
        try {
            const res = await fetch('/api/superadmin/organizations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newOrgName.trim(), adminEmail: newOrgAdminEmail.trim() }),
            });
            const data = await res.json();
            if (!res.ok && res.status !== 207) throw new Error(data.error || 'Failed to create organization');
            if (res.status === 207) setError(data.error); // partial success — surfaced, not thrown
            setNewOrgName('');
            setNewOrgAdminEmail('');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to create organization');
        } finally {
            setCreating(false);
        }
    };

    const toggleSuspend = async (org: Org) => {
        setError(null);
        try {
            const res = await fetch(`/api/superadmin/organizations/${org.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suspended: !org.suspended }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update organization');
            await load();
        } catch (e: any) {
            setError(e.message || 'Failed to update organization');
        }
    };

    const toggleExpand = async (orgId: string) => {
        if (expandedOrgId === orgId) {
            setExpandedOrgId(null);
            return;
        }
        setExpandedOrgId(orgId);
        setMembersLoading(true);
        try {
            const res = await fetch(`/api/superadmin/organizations/${orgId}/members`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load members');
            setExpandedMembers(data.members || []);
        } catch (e: any) {
            setError(e.message || 'Failed to load members');
        } finally {
            setMembersLoading(false);
        }
    };

    return (
        <AppLayout>
            <div className={styles.page}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Platform Admin</h1>
                    <p className={styles.subtitle}>Every organization on this deployment. Suspending one is a soft flag for record-keeping only — it does not yet block that organization&apos;s calls or logins.</p>
                </div>

                {error && <div className={styles.errorBanner}>{error}</div>}

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Organizations</h2>

                    <form className={styles.inlineForm} onSubmit={handleCreate}>
                        <input
                            type="text"
                            required
                            placeholder="Organization name"
                            className={styles.inputField}
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                        />
                        <input
                            type="email"
                            required
                            placeholder="First admin's email"
                            className={styles.inputField}
                            value={newOrgAdminEmail}
                            onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                        />
                        <button type="submit" className={styles.primaryBtn} disabled={creating}>
                            {creating ? 'Creating…' : 'Create organization'}
                        </button>
                    </form>

                    {loading ? (
                        <p className={styles.muted}>Loading…</p>
                    ) : orgs.length === 0 ? (
                        <p className={styles.muted}>No organizations yet.</p>
                    ) : (
                        <table className={styles.table}>
                            <thead>
                                <tr><th>Name</th><th>Status</th><th>Members</th><th>Created</th><th /></tr>
                            </thead>
                            <tbody>
                                {orgs.map((org) => (
                                    <Fragment key={org.id}>
                                        <tr>
                                            <td>
                                                <button className={styles.dangerBtn} style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border)' }} onClick={() => toggleExpand(org.id)}>
                                                    {expandedOrgId === org.id ? '▾' : '▸'} {org.name}
                                                </button>
                                            </td>
                                            <td>
                                                <span className={styles.badge}>{org.suspended ? 'Suspended' : 'Active'}</span>
                                            </td>
                                            <td>{org.memberCount}</td>
                                            <td>{new Date(org.createdAt).toLocaleDateString()}</td>
                                            <td>
                                                <button className={styles.dangerBtn} onClick={() => toggleSuspend(org)}>
                                                    {org.suspended ? 'Unsuspend' : 'Suspend'}
                                                </button>
                                            </td>
                                        </tr>
                                        {expandedOrgId === org.id && (
                                            <tr key={`${org.id}-members`}>
                                                <td colSpan={5}>
                                                    {membersLoading ? (
                                                        <span className={styles.muted}>Loading members…</span>
                                                    ) : expandedMembers.length === 0 ? (
                                                        <span className={styles.muted}>No members.</span>
                                                    ) : (
                                                        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                            {expandedMembers.map((m) => (
                                                                <li key={m.userId} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                                                                    {m.email} — <span className={styles.badge}>{m.role === 'org_admin' ? 'Org Admin' : 'Agent'}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            </div>
        </AppLayout>
    );
}
