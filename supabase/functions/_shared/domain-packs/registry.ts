/**
 * domain-packs/registry.ts — resolve a versioned `domain_pack` id to a pack.
 *
 * The Engine entrypoint takes `domain_pack` from the request (ENGINE_API_CONTRACT.md)
 * and resolves it here. wodwisdom pins "crossfit@3". A new sport registers its pack
 * and becomes selectable with no Engine-core change.
 */

import type { DomainPack } from "./types.ts";
import { CROSSFIT_PACK } from "./crossfit/index.ts";

export const DEFAULT_DOMAIN_PACK_ID = "crossfit@3";

const PACKS: Record<string, DomainPack> = {
  [CROSSFIT_PACK.id]: CROSSFIT_PACK,
};

/** Resolve a pack id (e.g. "crossfit@3"). Throws on unknown id so a caller never
 *  silently generates against the wrong sport. */
export function getDomainPack(id: string = DEFAULT_DOMAIN_PACK_ID): DomainPack {
  const pack = PACKS[id];
  if (!pack) {
    throw new Error(
      `Unknown domain_pack "${id}". Registered: ${Object.keys(PACKS).join(", ")}`,
    );
  }
  return pack;
}

/** List registered pack ids (for the engine-generate capability response). */
export function listDomainPacks(): string[] {
  return Object.keys(PACKS);
}
