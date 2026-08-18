// Stores the live-connection overrides (token, org, region, locale, client
// id) in localStorage. Mirrors the Angular AuthTokenStore signals as a
// plain observable store.
import { Store } from '../store';

const TOKEN_KEY = 'discovery-demo-auth-token';
const ORG_ID_KEY = 'discovery-demo-org-id';
const REGION_KEY = 'discovery-demo-region';
const TRACKING_KEY = 'discovery-demo-tracking-id';
const LANGUAGE_KEY = 'discovery-demo-language';
const COUNTRY_KEY = 'discovery-demo-country';
const CURRENCY_KEY = 'discovery-demo-currency';
const CLIENT_ID_KEY = 'discovery-demo-client-id';

export const REGION_HOSTS: Record<string, string> = {
  au: 'platform-au.cloud.coveo.com',
  na: 'platform.cloud.coveo.com',
  eu: 'platform-eu.cloud.coveo.com',
  dev: 'platformdev.cloud.coveo.com',
};

export type RequestDefaults = {
  trackingId: string;
  language: string;
  country: string;
  currency: string;
  clientId: string;
};

export type AuthTokenState = {
  token: string;
  orgId: string;
  region: string;
  trackingId: string;
  language: string;
  country: string;
  currency: string;
  clientId: string;
};

const PERSIST_KEYS: Record<keyof AuthTokenState, string> = {
  token: TOKEN_KEY,
  orgId: ORG_ID_KEY,
  region: REGION_KEY,
  trackingId: TRACKING_KEY,
  language: LANGUAGE_KEY,
  country: COUNTRY_KEY,
  currency: CURRENCY_KEY,
  clientId: CLIENT_ID_KEY,
};

export class AuthTokenStore extends Store<AuthTokenState> {
  constructor() {
    super({
      token: readInitial(TOKEN_KEY),
      orgId: readInitial(ORG_ID_KEY),
      region: readInitial(REGION_KEY),
      trackingId: readInitial(TRACKING_KEY),
      language: readInitial(LANGUAGE_KEY),
      country: readInitial(COUNTRY_KEY),
      currency: readInitial(CURRENCY_KEY),
      clientId: ensureClientId(),
    });
    persist(CLIENT_ID_KEY, this.getState().clientId);
  }

  private set(key: keyof AuthTokenState, value: string): void {
    const trimmed = value.trim();
    this.setState({ [key]: trimmed } as Partial<AuthTokenState>);
    persist(PERSIST_KEYS[key], trimmed);
  }

  setToken(value: string): void {
    this.set('token', value);
  }

  clearToken(): void {
    this.set('token', '');
  }

  setOrgId(value: string): void {
    this.set('orgId', value);
  }

  clearOrgId(): void {
    this.set('orgId', '');
  }

  setRegion(value: string): void {
    this.set('region', value);
  }

  clearRegion(): void {
    this.set('region', '');
  }

  setTrackingId(value: string): void {
    this.set('trackingId', value);
  }

  setLanguage(value: string): void {
    this.set('language', value);
  }

  setCountry(value: string): void {
    this.set('country', value);
  }

  setCurrency(value: string): void {
    this.set('currency', value);
  }

  setClientId(value: string): void {
    this.set('clientId', value);
  }

  regenerateClientId(): void {
    this.set('clientId', newUuid());
  }

  authorizationHeader(): string | null {
    const value = this.getState().token;
    if (!value) {
      return null;
    }
    return value.toLowerCase().startsWith('bearer ') ? value : `Bearer ${value}`;
  }

  resolveEndpoint(defaultEndpoint: string): string {
    let url = defaultEndpoint;
    const host = REGION_HOSTS[this.getState().region];
    if (host) {
      url = url.replace(/^https?:\/\/[^/]+/, `https://${host}`);
    }
    const id = this.getState().orgId;
    if (id) {
      url = url.replace(/\/organizations\/[^/]+\//, `/organizations/${id}/`);
    }
    return url;
  }

  resolveRequestDefaults(defaults: RequestDefaults): RequestDefaults {
    const state = this.getState();
    return {
      trackingId: state.trackingId || defaults.trackingId,
      language: state.language || defaults.language,
      country: state.country || defaults.country,
      currency: state.currency || defaults.currency,
      clientId: state.clientId || defaults.clientId || newUuid(),
    };
  }
}

function ensureClientId(): string {
  const stored = readInitial(CLIENT_ID_KEY);
  if (stored) {
    return stored;
  }
  return newUuid();
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'visitor-' + Math.random().toString(36).slice(2, 14);
}

function persist(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (value) {
    window.localStorage.setItem(key, value);
  } else {
    window.localStorage.removeItem(key);
  }
}

function readInitial(key: string): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem(key) ?? '';
}

/** Singleton instance (equivalent of Angular's root-provided service). */
export const authTokenStore = new AuthTokenStore();
