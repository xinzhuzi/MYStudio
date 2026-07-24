import { describe, expect, it } from "vitest";
import {
  getDefaultViewpointsForEnvironment,
  isViewpointCompatibleWithEnvironment,
  type ViewpointConfig,
} from "./scene-viewpoint-defaults";

describe("scene viewpoint default helpers", () => {
  it("returns environment-specific defaults with the shared overview/detail tail", () => {
    const vehicle = getDefaultViewpointsForEnvironment("vehicle");
    expect(vehicle.map(({ id }) => id)).toEqual([
      "vehicle_window",
      "vehicle_seat",
      "vehicle_aisle",
      "vehicle_driver",
      "overview",
      "detail",
    ]);

    const ancientOutdoor = getDefaultViewpointsForEnvironment("ancient_outdoor");
    expect(ancientOutdoor.map(({ id }) => id)).toEqual([
      "ancient_courtyard",
      "ancient_pavilion",
      "ancient_road",
      "ancient_gate",
      "overview",
      "detail",
    ]);
  });

  it("clones common defaults for unknown environments", () => {
    const first = getDefaultViewpointsForEnvironment("unknown");
    first[0].keyProps.push("mutated");

    const second = getDefaultViewpointsForEnvironment("unknown");
    expect(second).toEqual([
      expect.objectContaining({ id: "overview", keyProps: [] }),
      expect.objectContaining({ id: "detail", keyProps: [] }),
    ]);
  });

  it("checks explicit, universal, and unknown-environment compatibility", () => {
    const indoorOnly: ViewpointConfig = {
      id: "window",
      name: "窗边",
      nameEn: "Window",
      propsZh: [],
      propsEn: [],
      environments: ["indoor_home"],
    };
    const universal: ViewpointConfig = {
      ...indoorOnly,
      id: "overview",
      environments: [],
    };

    expect(isViewpointCompatibleWithEnvironment(indoorOnly, "indoor_home")).toBe(true);
    expect(isViewpointCompatibleWithEnvironment(indoorOnly, "outdoor")).toBe(false);
    expect(isViewpointCompatibleWithEnvironment(indoorOnly, "unknown")).toBe(true);
    expect(isViewpointCompatibleWithEnvironment(universal, "ancient_vehicle")).toBe(true);
  });
});
