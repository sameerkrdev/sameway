import type { ProposedStop, RouteInsertionCandidate } from "../types";

/**
 * Places the new pickup at slot `i` and the new drop at slot `j >= i` of the
 * existing sequence.
 *
 * Because both are inserted into a copy that is otherwise untouched, the
 * existing stops keep their relative order by construction — there is no
 * ordering to validate and nothing to discard. Pickup always precedes drop for
 * the same reason. The candidate count is exactly (n+1)(n+2)/2.
 */
export function enumerateInsertions(
  existingStops: readonly ProposedStop[],
  newPickup: ProposedStop,
  newDrop: ProposedStop,
): RouteInsertionCandidate[] {
  const n = existingStops.length;
  const candidates: RouteInsertionCandidate[] = [];

  for (let pickupIndex = 0; pickupIndex <= n; pickupIndex += 1) {
    const withPickup = [
      ...existingStops.slice(0, pickupIndex),
      newPickup,
      ...existingStops.slice(pickupIndex),
    ];

    for (let dropIndex = pickupIndex; dropIndex <= n; dropIndex += 1) {
      // +1 because the pickup already occupies a slot ahead of this position.
      const dropPosition = dropIndex + 1;
      candidates.push({
        pickupIndex,
        dropIndex,
        stops: [...withPickup.slice(0, dropPosition), newDrop, ...withPickup.slice(dropPosition)],
      });
    }
  }

  return candidates;
}
