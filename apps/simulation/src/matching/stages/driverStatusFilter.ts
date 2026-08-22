import type { DriverStatus } from "@/domain/entities";

import { reason, type MatchReason } from "../reasons";
import type { DriverVerdict, MatchingContext, MatchingStage, StageOutcome } from "../types";

const REJECTIONS: Record<Exclude<DriverStatus, "ONLINE">, () => MatchReason> = {
  OFFLINE: () => reason("DRIVER_OFFLINE", "Driver is offline", { value: "OFFLINE" }),
  PAUSED: () => reason("DRIVER_PAUSED", "Driver has paused new requests", { value: "PAUSED" }),
  BUSY: () => reason("DRIVER_BUSY", "Driver is marked busy and not accepting requests", {
    value: "BUSY",
  }),
};

/** Stage 2. Only ONLINE drivers continue. */
export const driverStatusFilterStage: MatchingStage = {
  id: "driverStatusFilter",
  name: "Driver Status",
  description: "Keeps only drivers whose status is ONLINE.",

  execute(context: MatchingContext): Promise<StageOutcome> {
    const verdicts: DriverVerdict[] = [];

    for (const driverId of context.liveDriverIds) {
      const driver = context.getDriver(driverId);

      if (!driver) {
        continue;
      }

      if (driver.status === "ONLINE") {
        verdicts.push({
          driverId,
          status: "PASSED",
          reasons: [reason("DRIVER_ONLINE", "Driver is online", { value: "ONLINE" })],
          metrics: { status: driver.status },
        });
        continue;
      }

      verdicts.push({
        driverId,
        status: "FAILED",
        reasons: [REJECTIONS[driver.status]()],
        metrics: { status: driver.status },
      });
    }

    return Promise.resolve({ verdicts });
  },
};
