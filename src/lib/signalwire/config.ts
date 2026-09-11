// Central place for SignalWire space/project config so it's read (and validated)
// consistently everywhere instead of scattering process.env lookups per-route.

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

export function getSignalWireConfig() {
    return {
        space: required('SIGNALWIRE_SPACE'),
        projectId: required('SIGNALWIRE_PROJECT_ID'),
        apiToken: required('SIGNALWIRE_API_TOKEN'),
        defaultNumber: process.env.SIGNALWIRE_DEFAULT_NUMBER || '',
        sipDomain: process.env.SIGNALWIRE_SIP_DOMAIN || `${required('SIGNALWIRE_SPACE')}`.replace(/\.signalwire\.com$/, '.sip.signalwire.com'),
    };
}

/** Basic-Auth header value (Project ID : API Token) for hitting the SignalWire REST/LaML API directly. */
export function signalWireBasicAuth(): string {
    const { projectId, apiToken } = getSignalWireConfig();
    return Buffer.from(`${projectId}:${apiToken}`).toString('base64');
}
