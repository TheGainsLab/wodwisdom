/** Time-domain colors and labels shared by the program and competition power charts. */

// Time-domain bucketing — buckets are ours (same boundaries on program +
// competition), so program and historical can share one color language.
export const BUCKET_ORDER: Array<'short' | 'medium' | 'long'> = ['short', 'medium', 'long'];
export const BUCKET_LABEL: Record<'short' | 'medium' | 'long', string> = {
  short: 'Short', medium: 'Medium', long: 'Long',
};
// Neutral slate ramp for the time-domain buckets so the bars stay on-brand
// (the red is reserved for selection). Ordinal: light → dark = short → long.
export const BUCKET_COLOR: Record<string, string> = {
  short: '#9aa3b2',   // light slate
  medium: '#5b6472',  // mid slate
  long: '#2f3742',    // dark slate
};
// Brand red — every bar gets a hairline of it; a tapped bar fills with it.
export const SELECTED_COLOR = '#F4433B';
