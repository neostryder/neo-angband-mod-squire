import { describe, expect, it } from "vitest";
import { errandMenuView, menuRows } from "./errand-menu.js";
import { errandMenu } from "../errands/catalog.js";
import { ERRAND_TEXT } from "../errands/text.js";
import { world } from "../harness.js";

describe("the errand menu rows", () => {
  const w = world({ map: ["#########", "#<..@..>#", "#########"] });
  const entries = errandMenu(w.view, w.terrain);

  it("numbers every errand and says why one cannot start", () => {
    const rows = menuRows({ key: "&", entries, suggested: [] });
    expect(rows.suggested).toEqual([]);
    expect(rows.all).toHaveLength(8);
    expect(rows.all[2]).toEqual({ position: 3, text: `3. ${ERRAND_TEXT.labels.down}`, enabled: true });
    expect(rows.all[7]).toEqual({ position: 8, text: `8. ${ERRAND_TEXT.labels.restock} (${ERRAND_TEXT.notNow} ${ERRAND_TEXT.reasons.notInTown})`, enabled: false });
  });

  it("puts the short list first, keeping each errand's own number", () => {
    const down = entries[2]!;
    const leave = entries[4]!;
    const rows = menuRows({ key: "&", entries, suggested: [leave, down] });
    expect(rows.suggested.map((row) => row.text)).toEqual([`5. ${ERRAND_TEXT.labels.leave}`, `3. ${ERRAND_TEXT.labels.down}`]);
  });

  it("does nothing without a panel API, and never throws from a broken one", () => {
    const logs: string[] = [];
    expect(() => errandMenuView(undefined, (m) => logs.push(m)).show({ key: "&", entries, suggested: [] }, () => {})).not.toThrow();
    const broken = errandMenuView({ openPanel: () => { throw new Error("no panels"); } }, (m) => logs.push(m));
    expect(() => broken.show({ key: "&", entries, suggested: [] }, () => {})).not.toThrow();
    expect(() => broken.hide()).not.toThrow();
    expect(logs.join("\n")).toContain("no panels");
  });
});
