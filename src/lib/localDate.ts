// Format a Date as a local YYYY-MM-DD string.
//
// Use this anywhere you need the *user's* calendar date, not UTC.
// Avoid `new Date().toISOString().slice(0, 10)` — that gives UTC,
// which silently produces the wrong date for any user not on UTC
// during a chunk of every day.

export function localDateString(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
