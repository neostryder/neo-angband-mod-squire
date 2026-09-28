import type { RunSummary } from "./summary.js";

/** The drawing surface needed for a share card, independent of DOM types. */
export interface CardContext {
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { readonly width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
}

export interface CardTheme {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly accent: string;
}

export const DEFAULT_CARD_THEME: CardTheme = {
  background: "#101820", foreground: "#f4f0e8", muted: "#aeb8bb", accent: "#d9ac64",
};

function fitted(ctx: CardContext, text: string, x: number, y: number, width: number): void {
  if (ctx.measureText(text).width <= width) { ctx.fillText(text, x, y); return; }
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}...`).width > width) end -= 1;
  ctx.fillText(`${text.slice(0, end)}...`, x, y);
}

/** Draws into a caller-owned 1200 by 630 canvas; it never creates or uploads one. */
export function drawCard(ctx: CardContext, model: RunSummary, theme: CardTheme = DEFAULT_CARD_THEME): void {
  ctx.save();
  try {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = theme.accent;
    ctx.font = "22px sans-serif";
    ctx.fillText("SQUIRE RUN", 56, 62);
    ctx.fillStyle = theme.foreground;
    ctx.font = "bold 54px sans-serif";
    fitted(ctx, model.headline.name, 56, 132, 650);
    ctx.font = "24px sans-serif";
    fitted(ctx, `${model.headline.race} ${model.headline.class}  |  Level ${String(model.headline.level)}`, 56, 177, 650);
    ctx.fillStyle = theme.accent;
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(model.headline.outcome.toUpperCase(), 56, 236);
    ctx.fillStyle = theme.foreground;
    ctx.font = "22px sans-serif";
    fitted(ctx, model.headline.outcome === "death" ? `Cause: ${model.headline.cause}` : model.headline.cause, 56, 274, 650);
    ctx.fillText(`Deepest: ${String(model.headline.deepestFeet)} ft`, 56, 318);
    ctx.fillStyle = theme.muted;
    ctx.font = "18px sans-serif";
    ctx.fillText("Top kills", 56, 370);
    ctx.fillStyle = theme.foreground;
    model.topKills.slice(0, 3).forEach((kill, index) => {
      fitted(ctx, `${kill.name} x${String(kill.count)}`, 56, 404 + index * 31, 600);
    });
    const highlight = model.chronicleHighlights[0];
    if (highlight) {
      ctx.fillStyle = theme.muted;
      ctx.font = "18px sans-serif";
      ctx.fillText("Chronicle", 56, 532);
      ctx.fillStyle = theme.foreground;
      fitted(ctx, highlight, 56, 566, 1080);
    }

    const radar = model.personaRadar;
    if (radar.length >= 3) {
      const cx = 940;
      const cy = 297;
      const radius = 174;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      radar.forEach((_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radar.length;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      radar.forEach((trait, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radar.length;
        const r = radius * Math.max(0, Math.min(100, trait.value)) / 100;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.fillStyle = theme.muted;
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PERSONA", cx, 505);
    }
  } finally { ctx.restore(); }
}

export function shareLinks(text: string, url?: string): { readonly x: string; readonly facebook?: string; readonly reddit: string } {
  const encoded = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${encoded}${url === undefined ? "" : `&url=${encodeURIComponent(url)}`}`,
    ...(url === undefined ? {} : { facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` }),
    reddit: `https://www.reddit.com/submit?title=${encoded}${url === undefined ? "" : `&url=${encodeURIComponent(url)}`}`,
  };
}
