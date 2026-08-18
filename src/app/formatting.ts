import { demoAgentConfig } from './demo-agent.config';

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: demoAgentConfig.liveRequestDefaults.currency || 'USD',
  maximumFractionDigits: 0,
});

export function formatPrice(value: number): string {
  return currencyFormatter.format(value);
}
