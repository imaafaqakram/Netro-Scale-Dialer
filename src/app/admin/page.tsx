import { redirect } from 'next/navigation';
import { getCurrentUserRole, canAccessAdmin } from '@/lib/auth/roles';
import { AdminDashboard } from './AdminDashboard';

// Server Component: the role check happens before anything renders or ships
// to the client, so an unauthorized user never sees the admin shell at all —
// not just a client-side redirect after the fact.
export default async function AdminPage() {
    const role = await getCurrentUserRole();

    if (!canAccessAdmin(role)) {
        redirect('/');
    }

    // canAccessAdmin already guarantees role is non-null and (super admin OR
    // has an orgId) — a super admin with no org membership of their own has
    // nothing to manage here and is sent to the platform-wide /superadmin
    // dashboard instead.
    if (!role!.orgId) {
        redirect('/superadmin');
    }

    return <AdminDashboard orgRole={role!.orgRole!} />;
}
