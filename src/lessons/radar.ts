import type { Persona } from "../persona/persona.js";
import type { SliderId } from "../persona/catalog.js";

export const LESSON_SLIDERS = ["boldness", "patience", "healat", "retreatat", "consumables", "levelfeel", "range"] as const satisfies readonly SliderId[];

export interface RadarContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
}

/** A fixed seven-axis chart lets the notebook and report compare the same traits. */
export function drawRadar(ctx: RadarContext, persona: Pick<Persona, "sliders">, x: number, y: number, radius: number,
  color: string, confidence?: Readonly<Partial<Record<SliderId, number>>>): void {
  ctx.save();
  try {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    ctx.font = "11px sans-serif";
    for (let i = 0; i < LESSON_SLIDERS.length; i += 1) {
      const key = LESSON_SLIDERS[i]!;
      const angle = -Math.PI / 2 + i * 2 * Math.PI / LESSON_SLIDERS.length;
      const edgeX = x + Math.cos(angle) * radius;
      const edgeY = y + Math.sin(angle) * radius;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(edgeX, edgeY); ctx.stroke();
      ctx.globalAlpha = confidence === undefined ? 1 : Math.max(0.2, Math.min(1, confidence[key] ?? 0));
      ctx.fillText(key, x + Math.cos(angle) * (radius + 25), y + Math.sin(angle) * (radius + 18));
    }
    ctx.beginPath();
    for (let i = 0; i < LESSON_SLIDERS.length; i += 1) {
      const key = LESSON_SLIDERS[i]!;
      const angle = -Math.PI / 2 + i * 2 * Math.PI / LESSON_SLIDERS.length;
      const distance = radius * Math.max(0, Math.min(100, persona.sliders[key])) / 100;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = confidence === undefined ? 0.3 : 0.18;
    ctx.fill();
    ctx.globalAlpha = confidence === undefined ? 1 : 0.6;
    ctx.stroke();
  } finally { ctx.restore(); }
}
