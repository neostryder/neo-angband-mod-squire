export interface NoulSample { readonly p: number; readonly y: 0 | 1 }
export interface ChoiceSample { readonly probs: Readonly<Record<string, number>>; readonly chosen: string; readonly good: boolean }
export interface PlattFit { readonly a: number; readonly b: number }

const EPS = 1e-6;
function clamp(p: number): number { return Math.max(EPS, Math.min(1 - EPS, Number.isFinite(p) ? p : 0.5)); }
function logit(p: number): number { const value = clamp(p); return Math.log(value / (1 - value)); }
function sigmoid(value: number): number { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }

/** A small identity prior keeps scarce or one-sided outcomes from overfitting. */
export function fitPlatt(samples: readonly NoulSample[]): PlattFit {
  if (samples.length < 20) return { a: 1, b: 0 };
  let a = 1;
  let b = 0;
  for (let step = 0; step < 400; step += 1) {
    let da = 0;
    let db = 0;
    for (const sample of samples) {
      const x = logit(sample.p);
      const error = sigmoid(a * x + b) - sample.y;
      da += error * x;
      db += error;
    }
    a -= 0.05 * (da / samples.length + 0.01 * (a - 1));
    b -= 0.05 * (db / samples.length + 0.01 * b);
  }
  return { a, b };
}

export function applyPlatt(p: number, fit: PlattFit): number {
  if (fit.a === 1 && fit.b === 0) return Math.max(0, Math.min(1, p));
  return sigmoid(fit.a * logit(p) + fit.b);
}

/** Normalize first, so even imperfect server probability totals remain usable. */
export function applyTemperature(probs: Readonly<Record<string, number>>, t: number): Record<string, number> {
  const keys = Object.keys(probs);
  if (keys.length === 0) return {};
  const temperature = Number.isFinite(t) && t > 0 ? t : 1;
  const scaled = keys.map((key) => Math.pow(Math.max(0, probs[key] ?? 0), 1 / temperature));
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(keys.map((key, index) => [key, total > 0 ? scaled[index]! / total : 1 / keys.length]));
}

/** Good picks raise chosen likelihood; bad picks lower it. */
export function fitTemperature(samples: readonly ChoiceSample[]): number {
  if (samples.length < 20) return 1;
  let best = 1;
  let bestLoss = Infinity;
  for (let index = 0; index <= 100; index += 1) {
    const temperature = 0.5 + index * 0.025;
    let loss = 0;
    for (const sample of samples) {
      const p = clamp(applyTemperature(sample.probs, temperature)[sample.chosen] ?? 0);
      loss -= Math.log(sample.good ? p : 1 - p);
    }
    if (loss < bestLoss - 1e-10 || (Math.abs(loss - bestLoss) <= 1e-10 && Math.abs(temperature - 1) < Math.abs(best - 1))) {
      bestLoss = loss;
      best = temperature;
    }
  }
  return best;
}

export function brier(samples: readonly NoulSample[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, sample) => sum + (sample.p - sample.y) ** 2, 0) / samples.length;
}

export type CalibrationEntry =
  | { readonly kind: "noul"; readonly samples: readonly NoulSample[]; readonly fit: PlattFit }
  | { readonly kind: "choice"; readonly samples: readonly ChoiceSample[]; readonly temperature: number };
export type CalibrationBook = Readonly<Record<string, CalibrationEntry>>;

/** Only the best-move question has a calibration key. In-character questions have none. */
export function bestMoveKey(backend: string, question: string): string { return `${backend}:${question}`; }

/** Call only with a key from bestMoveKey, never with an in-character answer. */
export function update(book: CalibrationBook, key: string, sample: NoulSample | ChoiceSample): CalibrationBook {
  const old = book[key];
  if ("p" in sample) {
    const previous = old?.kind === "noul" ? old.samples : [];
    return { ...book, [key]: { kind: "noul", samples: [...previous, sample].slice(-2000), fit: old?.kind === "noul" ? old.fit : { a: 1, b: 0 } } };
  }
  const previous = old?.kind === "choice" ? old.samples : [];
  return { ...book, [key]: { kind: "choice", samples: [...previous, sample].slice(-2000), temperature: old?.kind === "choice" ? old.temperature : 1 } };
}

export function refit(book: CalibrationBook): CalibrationBook {
  return Object.fromEntries(Object.entries(book).map(([key, entry]) => [key, entry.kind === "noul"
    ? { ...entry, fit: fitPlatt(entry.samples) }
    : { ...entry, temperature: fitTemperature(entry.samples) }]));
}
