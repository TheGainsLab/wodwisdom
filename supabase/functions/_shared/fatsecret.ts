/**
 * Shared FatSecret API proxy client.
 * All FatSecret calls go through a proxy server with a static IP whitelisted by FatSecret.
 */

const FATSECRET_PROXY_URL = "http://104.236.49.96:3000";

export async function callFatSecretAPI(
  method: string,
  params: Record<string, string | number>
): Promise<any> {
  const response = await fetch(FATSECRET_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("FatSecret proxy error:", response.status, errorText);
    throw new Error(`FatSecret proxy error: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || "FatSecret proxy returned unsuccessful response");
  }

  return result.data;
}

/** FatSecret returns single objects instead of arrays when there's only one result. */
export function normalizeToArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
