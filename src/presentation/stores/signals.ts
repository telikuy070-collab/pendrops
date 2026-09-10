/**
 * Signal-based Reactive Store - Lightweight, no dependencies
 * Inspired by Preact signals, SolidJS, Angular signals
 */

export interface Signal<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

export interface Computed<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

export interface Store<T extends Record<string, any>> {
  get<K extends keyof T>(key: K): Signal<T[K]>;
  set<K extends keyof T>(key: K, value: T[K] | ((prev: T[K]) => T[K])): void;
  subscribe(fn: (state: T) => void): () => void;
}

/** Create a simple signal */
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers = new Set<(value: T) => void>();

  const sig = {
    get value() { return value; },
    set value(newValue: T) {
      value = typeof newValue === 'function' ? (newValue as (prev: T) => T)(value) : newValue;
      subscribers.forEach(fn => fn(value));
    },
    subscribe(fn: (value: T) => void) {
      subscribers.add(fn);
      fn(value);
      return () => subscribers.delete(fn);
    }
  };

  return sig;
}

/** Create a computed signal */
export function computed<T>(fn: () => T): Computed<T> {
  const sig = signal(fn());
  
  // Track dependencies and recompute
  let computing = false;
  const originalFn = fn;
  
  return {
    get value() {
      if (computing) return sig.value;
      computing = true;
      try {
        sig.value = originalFn();
      } finally {
        computing = false;
      }
      return sig.value;
    },
    subscribe(fn: (value: T) => void) {
      return sig.subscribe(fn);
    }
  };
}

/** Create a reactive store */
export function createStore<T extends Record<string, any>>(initial: T): Store<T> {
  const signals = new Map<keyof T, Signal<any>>();
  const subscribers = new Set<(state: T) => void>();
  let state = { ...initial };

  // Initialize signals
  for (const key of Object.keys(initial) as (keyof T)[]) {
    signals.set(key, signal(initial[key]));
  }

  function notify() {
    subscribers.forEach(fn => fn(state));
  }

  return {
    get<K extends keyof T>(key: K): Signal<T[K]> {
      return signals.get(key)! as Signal<T[K]>;
    },
    set<K extends keyof T>(key: K, value: T[K] | ((prev: T[K]) => T[K])): void {
      const sig = signals.get(key)!;
      const newValue = typeof value === 'function' ? (value as (prev: T[K]) => T[K])(sig.value) : value;
      if (sig.value !== newValue) {
        sig.value = newValue;
        state = { ...state, [key]: newValue };
        notify();
      }
    },
    subscribe(fn: (state: T) => void) {
      subscribers.add(fn);
      fn(state);
      return () => subscribers.delete(fn);
    }
  };
}

/** Derived store - computed from other stores */
export function derivedStore<T extends Record<string, any>, U>(store: Store<T>, selector: (state: T) => U): Computed<U> {
  return computed(() => selector(store as any));
}