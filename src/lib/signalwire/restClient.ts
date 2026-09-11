// Thin wrapper around @signalwire/compatibility-api's RestClient — the drop-in
// replacement for the Twilio Node SDK's REST/TwiML surface (same client shape,
// just pointed at the SignalWire space instead of api.twilio.com).
import { RestClient } from '@signalwire/compatibility-api';
import { getSignalWireConfig } from './config';

export function getSignalWireClient() {
    const { projectId, apiToken, space } = getSignalWireConfig();
    return RestClient(projectId, apiToken, { signalwireSpaceUrl: space });
}
