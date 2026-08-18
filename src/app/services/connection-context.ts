// Resolves the effective connection context for turn telemetry from the
// same layered values the live request uses (static config defaults +
// per-visitor auth-token-store overrides). Captured once per prompt so an
// exported conversation reflects the connection it actually ran against,
// not whatever the panel is set to at export time.
import { demoAgentConfig, type DemoAgentMode } from '../demo-agent.config';
import type { TurnConnectionContext } from '../conversation.interfaces';
import { getLiveTransport } from './agent-demo.service';
import { authTokenStore, REGION_HOSTS } from './auth-token-store';

export function resolveConnectionContext(agentMode: DemoAgentMode): TurnConnectionContext {
  if (agentMode !== 'live') {
    return { agentMode };
  }

  const defaults = authTokenStore.resolveRequestDefaults(demoAgentConfig.liveRequestDefaults);
  const endpoint = authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint);

  return {
    agentMode,
    transport: getLiveTransport(),
    orgId: extractOrgId(endpoint),
    region: authTokenStore.getState().region || regionFromEndpoint(endpoint),
    trackingId: defaults.trackingId,
    language: defaults.language,
    country: defaults.country,
    currency: defaults.currency,
    clientId: defaults.clientId,
  };
}

function extractOrgId(endpoint: string): string | undefined {
  return /\/organizations\/([^/]+)\//.exec(endpoint)?.[1];
}

function regionFromEndpoint(endpoint: string): string | undefined {
  const host = /^https?:\/\/([^/]+)/.exec(endpoint)?.[1];
  if (!host) {
    return undefined;
  }
  return Object.entries(REGION_HOSTS).find(([, regionHost]) => regionHost === host)?.[0];
}
