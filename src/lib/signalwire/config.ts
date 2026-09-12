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
        // No safe way to derive this from SIGNALWIRE_SPACE — a space's actual SIP
        // registrar domain includes a project-specific suffix (e.g.
        // netroscale-llc-eb135bd8a9a9.sip.signalwire.com, not just
        // netroscale-llc.sip.signalwire.com) that isn't a pure function of the
        // space name. The wrong-but-plausible-looking guessed domain used to live
        // here and cost hours of debugging: it still resolves and issues a
        // real-looking digest challenge, then rejects every correctly-computed
        // response, because it's not routing to this project's actual credential
        // store. Get the real value from Dashboard -> SIP Endpoints (or from
        // another already-working SIP client's config, e.g. a FreeSWITCH trunk's
        // registrar URI) and set SIGNALWIRE_SIP_DOMAIN explicitly.
        sipDomain: required('SIGNALWIRE_SIP_DOMAIN'),
    };
}

/** Basic-Auth header value (Project ID : API Token) for hitting the SignalWire REST/LaML API directly. */
export function signalWireBasicAuth(): string {
    const { projectId, apiToken } = getSignalWireConfig();
    return Buffer.from(`${projectId}:${apiToken}`).toString('base64');
}
