// Vitest setup: register jest-dom matchers and give every test a clean
// localStorage so module-level singletons never leak state between files.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >= 22 ships its own global Web Storage (default-on from Node 25), and
// without --localstorage-file its methods throw. That broken global shadows
// jsdom's implementation in the vitest environment, killing every test at
// the beforeEach below. Probe the ambient storages and swap any broken one
// for an in-memory shim so the suite passes on stock Node, no flags needed.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(String(key)) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      data.set(String(key), String(value));
    },
  };
  return storage as Storage;
}

function isUsableStorage(candidate: unknown): boolean {
  try {
    const storage = candidate as Storage;
    const probe = '__vitest_storage_probe__';
    storage.setItem(probe, probe);
    const roundTripped = storage.getItem(probe) === probe;
    storage.removeItem(probe);
    return roundTripped;
  } catch {
    return false;
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let ambient: unknown;
  try {
    ambient = window[name];
  } catch {
    ambient = undefined;
  }
  if (isUsableStorage(ambient)) {
    continue;
  }
  const shim = createMemoryStorage();
  for (const target of new Set<object>([window, globalThis])) {
    Object.defineProperty(target, name, {
      value: shim,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});
