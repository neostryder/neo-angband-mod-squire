import { describe, expect, it } from "vitest";
import { CONFIG_FORMAT, LAYA_DEFAULT_URL, backendFor, confidenceFloor, defaultConfig, readConfig, writeConfig, type SquireConfig } from "./config.js";
import { CONFIDENCE_FLOOR } from "./brain/tactics.js";

describe("confidence floor", () => {
  it("is off for Jev, high for Laya and the default for any other server", () => {
    const floor = (backend: SquireConfig["backend"]) => confidenceFloor(backendFor({ ...defaultConfig(), backend })!);
    expect(floor("jev")).toBe(0);
    expect(floor("laya")).toBe(0.7);
    expect(floor("custom")).toBe(CONFIDENCE_FLOOR);
  });
});

describe("Laya shadow config", () => {
  it("defaults off and survives the prefs envelope", () => {
    expect(defaultConfig().layaShadow).toEqual({ enabled: false, url: LAYA_DEFAULT_URL, fallbacks: [] });
    const next = { ...defaultConfig(), layaShadow: { enabled: true, url: "http://127.0.0.1:9000/v1/systemone", fallbacks: ["http://192.168.2.154:8010/v1/systemone"] } };
    expect(readConfig(writeConfig(next)).layaShadow).toEqual(next.layaShadow);
  });

  it("uses defaults for missing or malformed shadow settings", () => {
    expect(readConfig({ format: CONFIG_FORMAT, data: {} }).layaShadow).toEqual(defaultConfig().layaShadow);
    expect(readConfig({ format: CONFIG_FORMAT, data: { layaShadow: { enabled: "yes", url: 42 } } }).layaShadow).toEqual(defaultConfig().layaShadow);
  });
});

describe("backup server addresses", () => {
  it("reads typed addresses in order and keeps them through the prefs envelope", async () => {
    const { parseAddresses } = await import("./config.js");
    const list = parseAddresses(" http://192.168.2.100:8010/v1/systemone, http://192.168.2.154:8010/v1/systemone ");
    expect(list).toEqual(["http://192.168.2.100:8010/v1/systemone", "http://192.168.2.154:8010/v1/systemone"]);
    const next = { ...defaultConfig(), serverFallbacks: list };
    expect(readConfig(writeConfig(next)).serverFallbacks).toEqual(list);
    expect(readConfig({ format: CONFIG_FORMAT, data: { serverFallbacks: "nope" } }).serverFallbacks).toEqual([]);
  });
});

describe("Laya model name", () => {
  it("asks Laya for the trained Squire model when the setting is empty", async () => {
    const { LAYA_DEFAULT_MODEL, backendFor } = await import("./config.js");
    expect(backendFor({ ...defaultConfig(), backend: "laya", serverModel: "" })?.model).toBe(LAYA_DEFAULT_MODEL);
    expect(backendFor({ ...defaultConfig(), backend: "laya", serverModel: "laya:@squire-test" })?.model).toBe("laya:@squire-test");
    expect(backendFor({ ...defaultConfig(), backend: "custom", serverModel: "" })?.model).toBeUndefined();
  });
});
