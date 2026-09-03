import { createClient } from '@/lib/supabase/server';

export type OrgRole = 'org_admin' | 'agent';

export interface UserRoleInfo {
    userId: string;
    isSuperAdmin: boolean;
    orgId: string | null;
    orgRole: OrgRole | null;
}

// Resolves the current request's authenticated user and their role. Uses the
// regular per-request client (respects the caller's own session), not the
// admin client — RLS on organization_members/super_admins (see
// supabase-migration-004-multi-tenant.sql) already scopes a plain SELECT to
// "your own membership row" / "am I actually a super admin," so there's no
// need for a service-role bypass here, and using the regular client means a
// bug in this helper can't accidentally leak another user's role data.
//
// NOT usable from middleware.ts — that runs on the Edge runtime with a
// different cookie API (request.cookies, not next/headers' cookies() that
// createClient() depends on). Call this from Server Components/Route
// Handlers instead: page components (src/app/admin/page.tsx,
// src/app/superadmin/page.tsx) call this + canAccessAdmin/canAccessSuperAdmin
// and redirect() if unauthorized; API routes do the same and return 403.
export async function getCurrentUserRole(): Promise<UserRoleInfo | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const [superAdminResult, membershipResult] = await Promise.all([
        supabase.from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
        supabase.from('organization_members').select('org_id, role').eq('user_id', user.id).maybeSingle(),
    ]);

    return {
        userId: user.id,
        isSuperAdmin: !!superAdminResult.data,
        orgId: membershipResult.data?.org_id ?? null,
        orgRole: (membershipResult.data?.role as OrgRole | undefined) ?? null,
    };
}

export function canAccessAdmin(info: UserRoleInfo | null): boolean {
    return !!info && (info.isSuperAdmin || info.orgRole === 'org_admin');
}

export function canAccessSuperAdmin(info: UserRoleInfo | null): boolean {
    return !!info?.isSuperAdmin;
}
