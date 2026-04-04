/**
 * Offline sync: replays queued mutations when the app comes back online.
 */
import { supabase, getAuthHeaders } from './supabase';
import { drainQueue, clearQueue, type QueuedMutation } from './offlineCache';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';

async function replayMutation(m: QueuedMutation): Promise<boolean> {
  try {
    switch (m.type) {
      case 'edge-function': {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/${m.target}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(m.payload),
        });
        return resp.ok;
      }
      case 'supabase-insert': {
        const { error } = await supabase.from(m.target).insert(m.payload as Record<string, unknown>);
        return !error;
      }
      case 'supabase-update': {
        const { table, match, fields } = m.payload as { table: string; match: Record<string, unknown>; fields: Record<string, unknown> };
        let q = supabase.from(table || m.target).update(fields);
        for (const [k, v] of Object.entries(match)) {
          q = q.eq(k, v as string);
        }
        const { error } = await q;
        return !error;
      }
      case 'supabase-delete': {
        const { id } = m.payload as { id: string };
        const { error } = await supabase.from(m.target).delete().eq('id', id);
        return !error;
      }
      case 'supabase-rpc': {
        const { fn, params } = m.payload as { fn: string; params: Record<string, unknown> };
        const { error } = await supabase.rpc(fn, params);
        return !error;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Attempt to replay all queued mutations. Returns count of successful replays.
 * On any failure, stops and keeps remaining items in queue.
 */
export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  const items = await drainQueue();
  if (items.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of items) {
    const ok = await replayMutation(item);
    if (ok) {
      synced++;
    } else {
      failed++;
      // Stop on first failure — remaining items stay in queue order
      break;
    }
  }

  if (failed === 0) {
    await clearQueue();
  }

  return { synced, failed };
}

/**
 * Set up automatic sync when the browser comes back online.
 */
export function setupAutoSync() {
  window.addEventListener('online', async () => {
    const result = await syncOfflineQueue();
    if (result.synced > 0) {
      console.log(`[offline-sync] Synced ${result.synced} queued mutations`);
    }
    if (result.failed > 0) {
      console.warn(`[offline-sync] ${result.failed} mutations failed to sync`);
    }
  });
}
