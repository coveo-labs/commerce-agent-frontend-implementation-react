import type { ComparisonSummarySurface } from '../models';

type ComparisonSummaryProps = {
  surface: ComparisonSummarySurface;
};

export function ComparisonSummary({ surface }: ComparisonSummaryProps) {
  return (
    <section className="surface summary">
      <div className="summary-lead">
        <p className="surface-kicker">Comparison Summary</p>
        <span>Assistant recommendation</span>
      </div>
      <p className="summary-text">{surface.text}</p>
    </section>
  );
}
