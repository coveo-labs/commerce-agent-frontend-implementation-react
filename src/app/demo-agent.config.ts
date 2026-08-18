// Central demo transport configuration.
// This file defines the default mode, the live transport implementation choice,
// and the default converse endpoint used when live mode is enabled. Point the
// endpoint at your Coveo Commerce organization to go live.
export type DemoAgentMode = 'mock' | 'live';
export type DemoLiveTransport = 'custom-fetch' | 'ag-ui-client';

export const demoAgentConfig = {
  mode: 'mock' as DemoAgentMode,
  liveTransport: 'custom-fetch' as DemoLiveTransport,
  liveEndpoint:
    'https://platformdev.cloud.coveo.com/rest/organizations/commerceplaygrounducp0r4a2/commerce/unstable/agentic/converse',
  liveHeaders: {
    Authorization: 'Bearer your-token-here',
  },
  liveRequestDefaults: {
    trackingId: 'commerce_demo',
    language: 'en',
    country: 'US',
    currency: 'USD',
    clientId: '',
  },
};

/**
 * One-click connection presets shown in the Live connection panel. Each
 * fills the organization, region, tracking id, and locale in one click.
 * The Bearer token is never part of a preset — it's short-lived and must
 * be taken live from the customer experience (DevTools → Network → copy
 * the Authorization header from any Coveo request).
 *
 * Empty by default. Add one entry per organization you demo against:
 *
 *   { label: 'Acme', orgId: 'acmeproduction1a2b3c4d', region: 'na',
 *     trackingId: 'acme_en_us', language: 'en', country: 'US', currency: 'USD' }
 */
export type LiveConnectionPreset = {
  /** Button label in the Connection panel. */
  label: string;
  orgId: string;
  /** Region key ('au' | 'na' | 'eu' | 'dev', '' = endpoint default). */
  region: string;
  trackingId: string;
  language: string;
  country: string;
  currency: string;
};

export const livePresets: LiveConnectionPreset[] = [];
