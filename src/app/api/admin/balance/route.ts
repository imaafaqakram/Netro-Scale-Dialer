import { NextResponse } from 'next/server';
import { getCurrentUserRole, canAccessAdmin } from '@/lib/auth/roles';
import { getAccountBalance } from '@/lib/signalwire/restClient';

// The SignalWire space (and its balance) is shared across the whole account,
// not scoped per-org — same admin-only visibility as /api/admin/numbers, since
// it's billing information, not something every agent needs to see.
export async function GET() {
    const role = await getCurrentUserRole();
    if (!canAccessAdmin(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const { balance, currency } = await getAccountBalance();
        return NextResponse.json({ balance, currency });
    } catch (error) {
        console.error('[Admin Balance] Failed to fetch SignalWire balance:', error);
        return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 502 });
    }
}
