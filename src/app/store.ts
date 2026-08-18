// Minimal observable store used to port the Angular signal-based services.
// Each Angular `@Injectable({ providedIn: 'root' })` service becomes a
// module-level singleton store; components subscribe with `useStoreState`.
import { useSyncExternalStore } from 'react';

export type Listener = () => void;

export class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  readonly getState = (): T => this.state;

  readonly setState = (update: Partial<T> | ((prev: T) => T)): void => {
    const next =
      typeof update === 'function'
        ? (update as (prev: T) => T)(this.state)
        : { ...this.state, ...update };
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  };

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

/** Subscribe a component to the full state object of a store. */
export function useStoreState<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
