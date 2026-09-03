import { getGoogleAccessToken } from './serviceAccountAuth';

// Minimal Google Sheets API v4 REST wrapper — just the three operations the CRM sync
// needs (src/lib/crm/sheetsCrm.ts): read a range, overwrite a range, append rows.
// No SDK — see serviceAccountAuth.ts for why.

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

async function authHeaders(): Promise<Record<string, string> | null> {
    const token = await getGoogleAccessToken();
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function getSheetValues(spreadsheetId: string, range: string): Promise<string[][] | null> {
    const headers = await authHeaders();
    if (!headers) return null;

    const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
        console.error(`[Google Sheets] getValues(${range}) failed: HTTP ${res.status} — ${await res.text()}`);
        return null;
    }

    const data = await res.json();
    return data.values || [];
}

export async function updateSheetValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<boolean> {
    const headers = await authHeaders();
    if (!headers) return false;

    const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    });

    if (!res.ok) {
        console.error(`[Google Sheets] updateValues(${range}) failed: HTTP ${res.status} — ${await res.text()}`);
        return false;
    }
    return true;
}

export async function appendSheetValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<boolean> {
    const headers = await authHeaders();
    if (!headers) return false;

    const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
    });

    if (!res.ok) {
        console.error(`[Google Sheets] appendValues(${range}) failed: HTTP ${res.status} — ${await res.text()}`);
        return false;
    }
    return true;
}
