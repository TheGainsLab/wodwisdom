import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// The offline cache uses IndexedDB; this gives the tests a working one.
import 'fake-indexeddb/auto';

// Things a browser has and jsdom does not.
Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = RO;
globalThis.fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))) as unknown as typeof fetch;

afterEach(() => { cleanup(); localStorage.clear(); });

// Every page gets the stand-in database instead of the real client. The rest
// of lib/supabase (endpoint constants) is the real module.
vi.mock('../../src/lib/supabase', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const { holder } = await import('./holder');
  const supabase = new Proxy({}, { get: (_t, k: string) => (holder.fake!.client as Record<string, unknown>)[k] });
  return { ...real, supabase, getAuthHeaders: async () => ({ Authorization: 'Bearer test', 'Content-Type': 'application/json' }) };
});
