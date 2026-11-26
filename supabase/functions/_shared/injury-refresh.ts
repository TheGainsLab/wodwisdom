/**
 * injury-refresh.ts — re-read an athlete's injury note into their avoid list
 * before a build, with retries.
 *
 * The re-read itself (parse-injuries-constraints) is a no-op when the list
 * was already made from the current note, so calling it before every build
 * costs nothing in the normal case and brings a stale list up to date.
 *
 * Why the retries (2026-11-24): the build tried once and carried on with the
 * old list if that one call failed. Three tries, then carry on: the old list
 * is kept (never dropped), and the writer is also given the athlete's own
 * words.
 */

export const INJURY_REFRESH_ATTEMPTS = 3;

export interface InjuryRefreshDeps {
  url: string;
  serviceKey: string;
  fetchFn?: typeof fetch;
  /** Wait between attempts; injectable so tests do not sleep. */
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** True when the list is now known to match the note. Never throws. */
export async function refreshAvoidListForBuild(userId: string, at: string, deps: InjuryRefreshDeps): Promise<boolean> {
  const doFetch = deps.fetchFn ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((l: string) => console.error(l));
  for (let attempt = 1; attempt <= INJURY_REFRESH_ATTEMPTS; attempt++) {
    try {
      const resp = await doFetch(`${deps.url}/functions/v1/parse-injuries-constraints`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deps.serviceKey}`,
          "x-webhook-user-id": userId,
        },
        body: "{}",
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) return true;
      // Structured tag for log-based monitoring. Queryable in fn Logs by tag.
      log(JSON.stringify({ tag: "injury_parse_failed", at, user_id: userId, http_status: resp.status, attempt }));
    } catch (e) {
      log(JSON.stringify({ tag: "injury_parse_failed", at, user_id: userId, error: e instanceof Error ? e.message : String(e), attempt }));
    }
    if (attempt < INJURY_REFRESH_ATTEMPTS) await wait(attempt * 800);
  }
  return false;
}
