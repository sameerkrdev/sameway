import { beforeEach, describe, expect, it } from "vitest";

import type { CommitPlan } from "@/matching/types";
import { useScenarioStore } from "@/stores/scenarioStore";

const plan: CommitPlan = {
  driverId: "",
  rideId: null,
  passengerId: "",
  requestId: "",
  stops: [],
};

describe("scenarioStore commit", () => {
  beforeEach(() => {
    useScenarioStore.getState().resetScenario();
  });

  it("creates a ride for an idle driver and adds the passenger", () => {
    const store = useScenarioStore.getState();
    const driver = store.scenario.drivers.find((entry) => entry.currentRideId === null)!;
    const request = store.scenario.requests[0]!;

    store.commitMatch({
      ...plan,
      driverId: driver.id,
      passengerId: request.passengerId,
      requestId: request.id,
      stops: [
        {
          id: "new:pickup",
          passengerId: request.passengerId,
          type: "PICKUP",
          location: request.pickup,
          originalEtaMin: 4,
        },
        {
          id: "new:drop",
          passengerId: request.passengerId,
          type: "DROP",
          location: request.drop,
          originalEtaMin: 22,
        },
      ],
    });

    const after = useScenarioStore.getState();
    const committedDriver = after.scenario.drivers.find((entry) => entry.id === driver.id)!;
    const ride = after.scenario.rides.find((entry) => entry.id === committedDriver.currentRideId)!;

    expect(ride.passengerIds).toContain(request.passengerId);
    expect(ride.stops.map((stop) => stop.sequence)).toEqual([0, 1]);
    expect(ride.stops[1]!.originalEtaMin).toBe(22);
    // The request is consumed, so a second run cannot match it again.
    expect(after.scenario.requests.some((entry) => entry.id === request.id)).toBe(false);
  });

  it("restores the pre-commit scenario on undo", () => {
    const store = useScenarioStore.getState();
    const before = structuredClone(store.scenario);
    const driver = store.scenario.drivers.find((entry) => entry.currentRideId === null)!;
    const request = store.scenario.requests[0]!;

    store.commitMatch({
      ...plan,
      driverId: driver.id,
      passengerId: request.passengerId,
      requestId: request.id,
      stops: [
        {
          id: "new:pickup",
          passengerId: request.passengerId,
          type: "PICKUP",
          location: request.pickup,
          originalEtaMin: 4,
        },
      ],
    });

    expect(useScenarioStore.getState().scenario).not.toEqual(before);

    useScenarioStore.getState().undoCommit();

    expect(useScenarioStore.getState().scenario).toEqual(before);
    expect(useScenarioStore.getState().lastCommittedScenario).toBeNull();
  });

  it("ignores a plan naming a driver that does not exist", () => {
    const store = useScenarioStore.getState();
    const before = structuredClone(store.scenario);

    store.commitMatch({ ...plan, driverId: "nobody" });

    expect(useScenarioStore.getState().scenario).toEqual(before);
  });
});
