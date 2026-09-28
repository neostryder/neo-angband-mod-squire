import { describe, expect, it } from "vitest";
import { CONFIG_FORMAT, LAYA_DEFAULT_URL, defaultConfig, readConfig, writeConfig } from "./config.js";

describe("Laya shadow config", () => {
  it("defaults off and survives the prefs envelope", () => {
    expect(defaultConfig().layaShadow).toEqual({ enabled: false, url: LAYA_DEFAULT_URL });
    const next = { ...defaultConfig(), layaShadow: { enabled: true, url: "http://127.0.0.1:9000/v1/systemone" } };
    expect(readConfig(writeConfig(next)).layaShadow).toEqual(next.layaShadow);
  });

  it("uses defaults for missing or malformed shadow settings", () => {
    expect(readConfig({ format: CONFIG_FORMAT, data: {} }).layaShadow).toEqual(defaultConfig().layaShadow);
    expect(readConfig({ format: CONFIG_FORMAT, data: { layaShadow: { enabled: "yes", url: 42 } } }).layaShadow).toEqual(defaultConfig().layaShadow);
  });
});
