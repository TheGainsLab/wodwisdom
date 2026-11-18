import { useSyncExternalStore } from 'react';

/**
 * One value per lift, shared by every calculator on /calculators: a back
 * squat typed into one card fills every other "Back squat" box (founder,
 * 2026-11-18). Held in memory only — nothing is saved, and it is gone on a
 * reload.
 */

const values = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setSharedLift(key: string, value: string): void {
  values.set(key, value);
  listeners.forEach((l) => l());
}

/** [value, setValue] for one lift, kept in step across cards. */
export function useSharedLift(key: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(subscribe, () => values.get(key) ?? '', () => '');
  return [value, (v: string) => setSharedLift(key, v)];
}
