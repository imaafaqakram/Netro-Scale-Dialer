import { getSheetValues, updateSheetValues, appendSheetValues } from '@/lib/google/sheetsClient';
import { isGoogleSheetsConfigured } from '@/lib/google/serviceAccountAuth';

// Google Sheets acts as the CRM itself (no separate CRM vendor for now, per user
// decision) — one row per client phone number, updated on every call/voicemail with
// the latest query summary and transcript. Deliberately NOT prefixing ranges with a
// sheet/tab name (e.g. just "A:I" not "Sheet1!A:I") so this works against the first
// tab of whatever the user names their spreadsheet, no configuration needed beyond
// the spreadsheet ID itself.

const HEADER = ['Phone Number', 'Name', 'Email', 'Last Query', 'Last Transcript', 'Type', 'Direction', 'Last Call Date', 'Total Calls'];
const DATA_RANGE = 'A2:I';
const FULL_RANGE = 'A:I';
const MAX_CELL_CHARS = 45000; // Sheets cells cap at 50,000 chars; leave headroom.

export interface CrmUpsertParams {
    phoneNumber: string;
    name?: string | null;
    email?: string | null;
    query?: string | null;
    transcript?: string | null;
    type: 'call' | 'voicemail';
    direction: 'incoming' | 'outgoing';
}

function normalizePhone(phone: string): string {
    return (phone || '').replace(/[^0-9]/g, '').replace(/^1(\d{10})$/, '$1');
}

function truncate(text: string | null | undefined): string {
    if (!text) return '';
    return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) + '… [truncated]' : text;
}

async function ensureHeader(spreadsheetId: string, existingFirstRow: string[] | undefined): Promise<void> {
    const looksLikeHeader = existingFirstRow && existingFirstRow[0] === HEADER[0];
    if (looksLikeHeader) return;
    await updateSheetValues(spreadsheetId, 'A1:I1', [HEADER]);
}

// Finds the client's existing row (by normalized phone number) and updates it in
// place, or appends a new one. Not transactional — a concurrent write to the same
// phone number could race, which is an acceptable tradeoff for a call log (worst case
// is a duplicate row, not lost data) rather than the complexity of real locking against
// a spreadsheet.
export async function upsertCrmRow(spreadsheetId: string, params: CrmUpsertParams): Promise<boolean> {
    if (!spreadsheetId) return false;
    if (!isGoogleSheetsConfigured()) {
        console.warn('[Sheets CRM] GOOGLE_SERVICE_ACCOUNT_KEY not configured — skipping sheet sync.');
        return false;
    }

    try {
        const allRows = await getSheetValues(spreadsheetId, FULL_RANGE);
        if (allRows === null) return false;

        await ensureHeader(spreadsheetId, allRows[0]);

        const targetPhone = normalizePhone(params.phoneNumber);
        const dataRows = allRows.slice(1); // skip header
        const matchIndex = dataRows.findIndex((row) => normalizePhone(row[0] || '') === targetPhone && targetPhone);

        const now = new Date().toISOString();

        if (matchIndex === -1) {
            const newRow = [
                params.phoneNumber || 'Unknown',
                params.name || '',
                params.email || '',
                truncate(params.query),
                truncate(params.transcript),
                params.type,
                params.direction,
                now,
                1,
            ];
            return await appendSheetValues(spreadsheetId, DATA_RANGE, [newRow]);
        }

        const existing = dataRows[matchIndex];
        const rowNumber = matchIndex + 2; // +1 for header, +1 for 1-indexing
        const priorCount = parseInt(existing[8] || '0', 10) || 0;

        const mergedRow = [
            params.phoneNumber || existing[0] || 'Unknown',
            params.name || existing[1] || '',
            params.email || existing[2] || '',
            truncate(params.query) || existing[3] || '',
            truncate(params.transcript) || existing[4] || '',
            params.type,
            params.direction,
            now,
            priorCount + 1,
        ];

        return await updateSheetValues(spreadsheetId, `A${rowNumber}:I${rowNumber}`, [mergedRow]);
    } catch (e) {
        console.error('[Sheets CRM] upsertCrmRow failed:', e);
        return false;
    }
}
