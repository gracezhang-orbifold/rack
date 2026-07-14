import { describe, it, expect } from "vitest";
import { parseAssetId } from "./scan";

describe("parseAssetId", () => {
  it("extracts the asset id from a label URL", () => {
    expect(parseAssetId("https://rack.example.com/scan/RACK-0012")).toBe("RACK-0012");
    expect(parseAssetId("http://localhost:5173/scan/RACK-0001?x=1")).toBe("RACK-0001");
  });
  it("decodes URL-encoded asset ids", () => {
    expect(parseAssetId("https://rack.example.com/scan/AB%2012")).toBe("AB 12");
  });
  it("accepts a bare asset id typed by hand", () => {
    expect(parseAssetId("  RACK-0044 ")).toBe("RACK-0044");
  });
  it("rejects unrelated URLs and empty input", () => {
    expect(parseAssetId("https://example.com/other")).toBeNull();
    expect(parseAssetId("   ")).toBeNull();
  });
});
