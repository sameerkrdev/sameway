import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/domain/settings";
import {
  delayBudgetMinFromPercent,
  resolveDelayPercent,
  soloEtaMinForStop,
} from "@/matching/delayBudget";

describe("delayBudget", () => {
  it("derives solo ETA as drop minus pickup for a waiting passenger", () => {
    const stops = [
      { passengerId: "pA", type: "PICKUP" as const, originalEtaMin: 4 },
      { passengerId: "pA", type: "DROP" as const, originalEtaMin: 15 },
    ];

    expect(soloEtaMinForStop(stops[1]!, stops)).toBe(11);
  });

  it("uses the drop ETA as solo ETA for an onboard passenger", () => {
    const stops = [{ passengerId: "pA", type: "DROP" as const, originalEtaMin: 10 }];

    expect(soloEtaMinForStop(stops[0]!, stops)).toBe(10);
  });

  it("applies 250% on short solo trips", () => {
    expect(resolveDelayPercent(4, 50, DEFAULT_SETTINGS)).toBe(250);
    expect(delayBudgetMinFromPercent(4, 50, DEFAULT_SETTINGS)).toBe(10);
  });

  it("applies the configured percent on longer solo trips", () => {
    expect(resolveDelayPercent(20, 50, DEFAULT_SETTINGS)).toBe(50);
    expect(delayBudgetMinFromPercent(20, 50, DEFAULT_SETTINGS)).toBe(10);
  });
});
