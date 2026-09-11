import { config } from './config';

export interface SipCredentialsResponse {
    username: string;
    password: string;
    domain: string;
    wsUri: string;
    identity: string;
}

export async function fetchSipCredentials(): Promise<SipCredentialsResponse> {
    const response = await fetch(config.sipCredentialsUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch SIP credentials: ${response.status} ${response.statusText}`);
    }

    return response.json();
}
