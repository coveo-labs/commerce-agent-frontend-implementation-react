// Compact live-connection control: a header button (shown only in live mode)
// that mirrors the conversation-controls button. The Bearer token, org ID and
// request defaults live in a popover that opens on click.
import { useEffect, useRef, useState } from 'react';
import { demoAgentConfig, livePresets, type LiveConnectionPreset } from '../demo-agent.config';
import { authTokenStore } from '../services/auth-token-store';
import { useStoreState } from '../store';

/**
 * Fill every connection field from a preset — except the Bearer token,
 * which is short-lived and must be pasted live from the experience.
 */
function applyPreset(preset: LiveConnectionPreset): void {
  authTokenStore.setOrgId(preset.orgId);
  authTokenStore.setRegion(preset.region);
  authTokenStore.setTrackingId(preset.trackingId);
  authTokenStore.setLanguage(preset.language);
  authTokenStore.setCountry(preset.country);
  authTokenStore.setCurrency(preset.currency);
}

function clearOverrides(): void {
  authTokenStore.clearOrgId();
  authTokenStore.clearRegion();
  authTokenStore.setTrackingId('');
  authTokenStore.setLanguage('');
  authTokenStore.setCountry('');
  authTokenStore.setCurrency('');
}

export function AuthTokenInput() {
  const auth = useStoreState(authTokenStore);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const host = wrapperRef.current;
      if (host && !host.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);

  const defaults = demoAgentConfig.liveRequestDefaults;
  const hasToken = auth.token.length > 0;
  const hasOverrides =
    auth.orgId.length > 0 ||
    auth.region.length > 0 ||
    auth.trackingId.length > 0 ||
    auth.language.length > 0 ||
    auth.country.length > 0 ||
    auth.currency.length > 0;
  const maskedPreview = hasToken ? `••••${auth.token.slice(-4)}` : '';
  const resolvedEndpoint = authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint);
  const defaultOrgId = extractOrgId(demoAgentConfig.liveEndpoint);

  return (
    <div className="conn-controls" ref={wrapperRef}>
      <button
        type="button"
        className={`conn-button${open ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Live connection settings"
      >
        <span className={`conn-dot${hasToken ? ' is-set' : ''}`} aria-hidden="true"></span>
        <span className="conn-label">Connection</span>
        <span className="conn-status">{hasToken ? maskedPreview : 'No token'}</span>
        <span className={`conn-chevron${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="conn-popover" role="dialog" aria-label="Live connection">
          <p className="eyebrow">Live connection</p>
          <p className="auth-token-help">
            Paste a Bearer token issued for your Coveo organization and the organization ID to
            exercise the live conversational endpoint. Both are stored locally in your browser.
            {livePresets.length > 0 && (
              <>
                {' '}
                Use the{' '}
                <strong>{livePresets.map((preset) => preset.label).join(' / ')}</strong> shortcut
                to fill in a known organization — then paste a fresh token taken live from that
                experience.
              </>
            )}
          </p>

          <label className="auth-token-field">
            <span className="auth-token-label">Bearer token</span>
            <div className="auth-token-row">
              <input
                className="auth-token-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your token here…"
                value={auth.token}
                onChange={(event) => authTokenStore.setToken(event.target.value)}
              />
              <button
                type="button"
                className="ghost-button"
                disabled={!hasToken}
                onClick={() => authTokenStore.clearToken()}
              >
                Clear
              </button>
            </div>
          </label>

          <label className="auth-token-field">
            <span className="auth-token-label">
              Organization ID
              <span className="auth-token-default">default: {defaultOrgId}</span>
            </span>
            <div className="auth-token-row">
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. mycompanyproduction1a2b3c4d"
                value={auth.orgId}
                onChange={(event) => authTokenStore.setOrgId(event.target.value)}
              />
              <select
                className="auth-token-input auth-token-select"
                value={auth.region}
                onChange={(event) => authTokenStore.setRegion(event.target.value)}
              >
                <option value="">Default region</option>
                <option value="au">AU</option>
                <option value="na">NA</option>
                <option value="eu">EU</option>
                <option value="dev">Dev</option>
              </select>
              {livePresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="ghost-button"
                  title={`${preset.orgId} · ${preset.region.toUpperCase()} · ${preset.trackingId}`}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className="ghost-button"
                disabled={!hasOverrides}
                onClick={clearOverrides}
              >
                Reset
              </button>
            </div>
            <p className="auth-token-resolved">
              Resolved endpoint: <code>{resolvedEndpoint}</code>
            </p>
          </label>

          <label className="auth-token-field">
            <span className="auth-token-label">
              Tracking ID
              <span className="auth-token-default">default: {defaults.trackingId}</span>
            </span>
            <div className="auth-token-row">
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={defaults.trackingId}
                value={auth.trackingId}
                onChange={(event) => authTokenStore.setTrackingId(event.target.value)}
              />
            </div>
          </label>

          <div className="auth-token-grid">
            <label className="auth-token-field">
              <span className="auth-token-label">
                Language
                <span className="auth-token-default">{defaults.language}</span>
              </span>
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={defaults.language}
                value={auth.language}
                onChange={(event) => authTokenStore.setLanguage(event.target.value)}
              />
            </label>
            <label className="auth-token-field">
              <span className="auth-token-label">
                Country
                <span className="auth-token-default">{defaults.country}</span>
              </span>
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={defaults.country}
                value={auth.country}
                onChange={(event) => authTokenStore.setCountry(event.target.value)}
              />
            </label>
            <label className="auth-token-field">
              <span className="auth-token-label">
                Currency
                <span className="auth-token-default">{defaults.currency}</span>
              </span>
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={defaults.currency}
                value={auth.currency}
                onChange={(event) => authTokenStore.setCurrency(event.target.value)}
              />
            </label>
          </div>

          <label className="auth-token-field">
            <span className="auth-token-label">
              Client ID (visitor)
              <span className="auth-token-default">auto-generated UUID, persisted</span>
            </span>
            <div className="auth-token-row">
              <input
                className="auth-token-input auth-token-input--text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="visitor uuid"
                value={auth.clientId}
                onChange={(event) => authTokenStore.setClientId(event.target.value)}
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => authTokenStore.regenerateClientId()}
              >
                New
              </button>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

function extractOrgId(endpoint: string): string {
  const match = endpoint.match(/\/organizations\/([^/]+)\//);
  return match ? match[1] : '';
}
