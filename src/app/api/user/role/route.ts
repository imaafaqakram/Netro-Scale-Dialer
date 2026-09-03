import { NextResponse } from 'next/server';
import { getCurrentUserRole } from '@/lib/auth/roles';

// Lightweight endpoint for client components (e.g. the Sidebar) to know
// whether to show Admin / Super Admin navigation links — the actual
// authorization for those routes happens server-side on the pages
// themselves (src/app/admin/page.tsx, src/app/superadmin/page.tsx) and in
// every API route under /api/admin, /api/superadmin; this only controls UI
// visibility.
export async function GET() {
    const role = await getCurrentUserRole();
    if (!role) {
        return NextResponse.json({ isSuperAdmin: false, orgRole: null });
    }
    return NextResponse.json({ isSuperAdmin: role.isSuperAdmin, orgRole: role.orgRole });
}
