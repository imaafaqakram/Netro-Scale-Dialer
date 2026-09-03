import { redirect } from 'next/navigation';
import { getCurrentUserRole, canAccessSuperAdmin } from '@/lib/auth/roles';
import { SuperAdminDashboard } from './SuperAdminDashboard';

export default async function SuperAdminPage() {
    const role = await getCurrentUserRole();

    if (!canAccessSuperAdmin(role)) {
        redirect('/');
    }

    return <SuperAdminDashboard />;
}
