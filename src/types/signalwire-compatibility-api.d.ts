// @signalwire/compatibility-api ships real types (compatibility-api.d.ts), but its
// package.json "exports" map doesn't resolve them under TypeScript's "bundler"
// moduleResolution — this ambient module short-circuits that resolution failure.
// The actual runtime shape mirrors the Twilio Node SDK's RestClient (calls, recordings,
// incomingPhoneNumbers, etc.), just loosely typed here rather than duplicating it.
declare module '@signalwire/compatibility-api' {
    export function RestClient(projectId: string, apiToken: string, options: { signalwireSpaceUrl: string }): any;
}
