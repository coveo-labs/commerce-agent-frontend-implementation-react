import type { NextActionsBarSurface } from '../models';

type NextActionsBarProps = {
  surface: NextActionsBarSurface;
  onSelectAction: (action: string) => void;
};

const PLACEHOLDERS = Array.from({ length: 3 }, (_, index) => index);

export function NextActionsBar({ surface, onSelectAction }: NextActionsBarProps) {
  return (
    <section className="surface">
      <header className="surface-header stacked">
        <p className="surface-kicker">Next Actions</p>
        <h3>Suggested next steps</h3>
      </header>

      {!surface.isLoading ? (
        <div className="actions">
          {surface.actions.map((action) => (
            <button
              key={`${action.text}:${action.type}`}
              type="button"
              onClick={() => onSelectAction(action.text)}
            >
              {action.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="loading-row">
          {PLACEHOLDERS.map((index) => (
            <span key={index}></span>
          ))}
        </div>
      )}
    </section>
  );
}
