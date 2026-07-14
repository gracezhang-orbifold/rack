import { describe, it, expect } from "vitest";
import { filterInventory, groupByCategory } from "./filter";
import type { AvailabilityItem } from "./types";

const mk = (name: string, category: string, asset_ids: string[] = []): AvailabilityItem => ({
  item_type_id: name, name, category, notes: null,
  total_units: 1, available_units: 1, in_use_units: 0, needs_repair_units: 0, missing_units: 0,
  asset_ids,
});
const items = [mk("GoPro 13 Black", "Camera", ["RACK-0001", "RACK-0002"]), mk("Tripod", "Camera Accessories"), mk("Manus Gloves", "Tracking", ["RACK-0017"])];

describe("filterInventory", () => {
  it("returns all when query is blank", () => {
    expect(filterInventory(items, "  ")).toHaveLength(3);
  });
  it("matches on name, case-insensitively", () => {
    expect(filterInventory(items, "gopro").map((i) => i.name)).toEqual(["GoPro 13 Black"]);
  });
  it("matches on category", () => {
    expect(filterInventory(items, "tracking").map((i) => i.name)).toEqual(["Manus Gloves"]);
  });
  it("matches on asset id, case-insensitively", () => {
    expect(filterInventory(items, "rack-0017").map((i) => i.name)).toEqual(["Manus Gloves"]);
    expect(filterInventory(items, "RACK-000").map((i) => i.name)).toEqual(["GoPro 13 Black"]);
  });
  it("tolerates items without asset ids", () => {
    const legacy = { ...mk("Old", "Misc"), asset_ids: undefined as unknown as string[] };
    expect(filterInventory([legacy], "old")).toHaveLength(1);
    expect(filterInventory([legacy], "rack")).toHaveLength(0);
  });
});

describe("groupByCategory", () => {
  it("groups items under their category preserving order", () => {
    const groups = groupByCategory(items);
    expect(groups.map(([c]) => c)).toEqual(["Camera", "Camera Accessories", "Tracking"]);
    expect(groups[0][1]).toHaveLength(1);
  });
});
