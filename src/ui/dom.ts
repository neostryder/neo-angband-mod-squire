/**
 * A few DOM helpers for the Squire panel. The panel is plain DOM inside the
 * shadow root the host gives it, so it needs no framework and carries no
 * dependency into plugin.js.
 */

type Child = Node | string | null | undefined | false;

/** Make an element with attributes, event handlers and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Readonly<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key in el && typeof value !== "string") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/** Replace an element's children. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** Offer a file for the player to save, without any network. */
export function download(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Ask the player for a file and read it as text. */
export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.click();
  });
}

export const STYLE = `
:host { all: initial; }
.squire { font: 13px/1.45 system-ui, sans-serif; color: #e8e2d0; background: #14120f; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid #3a342a; padding: 4px 4px 0; }
.tabs button { background: none; border: 1px solid transparent; border-bottom: none; color: #b9ae93; padding: 4px 8px; cursor: pointer; font: inherit; border-radius: 4px 4px 0 0; }
.tabs button[aria-selected="true"] { background: #221e18; color: #f2e6c4; border-color: #3a342a; }
.body { flex: 1; overflow: auto; padding: 10px; }
h3 { font-size: 13px; margin: 14px 0 6px; color: #f2c66d; }
h3:first-child { margin-top: 0; }
p { margin: 4px 0; }
.muted { color: #9b917a; }
.ok { color: #8fd18f; }
.bad { color: #ef8f7f; }
label { display: block; margin: 6px 0; }
input[type=text], input[type=password], input[type=number], select, textarea { width: 100%; box-sizing: border-box; background: #0c0b09; color: #e8e2d0; border: 1px solid #4a4336; border-radius: 3px; padding: 4px 6px; font: inherit; }
textarea { min-height: 70px; resize: vertical; }
input[type=range] { width: 100%; }
button.act { background: #3a2f1c; color: #f2e6c4; border: 1px solid #6b5a38; border-radius: 3px; padding: 4px 10px; cursor: pointer; font: inherit; margin: 4px 4px 4px 0; }
button.act:hover { background: #4a3c24; }
.row { display: flex; gap: 6px; align-items: center; }
.row > * { flex: 1; }
.slider { display: grid; grid-template-columns: 9em 1fr 2.5em; gap: 6px; align-items: center; margin: 3px 0; }
.slider .ends { grid-column: 2; font-size: 11px; color: #9b917a; display: flex; justify-content: space-between; margin-top: -4px; }
pre { background: #0c0b09; border: 1px solid #3a342a; padding: 6px; overflow: auto; max-height: 240px; font-size: 11px; }
.entry { border-top: 1px solid #2c271f; padding: 6px 0; }
.entry.disagree { color: #f2e6c4; }
.stat { display: inline-block; margin-right: 14px; }
.stat b { color: #f2c66d; }
canvas { width: 100%; background: #0c0b09; border: 1px solid #3a342a; }
`;
