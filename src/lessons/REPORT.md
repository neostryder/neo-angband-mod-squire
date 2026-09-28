# Knight's Lessons

## Files and exports

- `evidence.ts`: `commandEvidence` records command kind, turn, danger, health, and explored share; `signatureForView` records encounter facts for exams.
- `radar.ts`: `LESSON_SLIDERS`, `RadarContext`, and `drawRadar` draw the seven inferred traits without a DOM dependency.
- `persona.ts`: `saveInferredPersona` adds the inferred style to the persona library and optionally activates it.
- `ghost.ts`: `ghostHint` names the squire's pick and a visible target; `ghostAfterCommand` clears a hint when the next command matches.
- `exam.ts`: `styleGoal`, `scoreExam`, and `subscribeExam` arm, score, and finish exams from runtime decisions.
- `lessons.test.ts`: evidence, radar, persona, ghost, and exam tests.

## Changes outside `src/lessons/`

- `src/knight.ts` adds command evidence, encounter signatures, confidence, ghost state, and the last ten exams to the apprentice. Missing fields in older saved data get defaults in `src/attach.ts`.
- `src/attach.ts` collects command evidence, persists the apprentice under `squire/apprentice`, connects exams and the ghost, and exposes the Lessons tab controls. `src/attach.test.ts` checks persistence and the exam result.
- `src/learning/ranks.ts` counts melee commands as fights for danger-based boldness.
- `src/ui/lessons.ts` shows the two radars, inferred sliders, persona buttons, ghost switch, and exam control.
- `src/runtime.ts` adds only `decisionView()` so exam scoring can use the view behind `onDecision`. End-of-run summary creation reads the existing apprentice store key.
- `src/report/summary.ts`, `render.ts`, `card.ts`, and `src/ui/report-view.ts` add apprenticeship data to the summary, Markdown, JSON, share card, and report tab. Their tests cover the new section.

## Judgment calls and limits

- The Core agent view and Squire context expose no safe overlay or marker API. The ghost uses a line at the top of Lessons.
- Explored share is known map cells divided by map area when the knight descends. Unknown passable terrain cannot be counted from the view.
- The character key is the available name at save time; the style falls back to `Player's style` when no key is available.
- Exams score the decisions delivered by `Runtime.onDecision`. Fixed errand decisions do not emit that event, so they do not enter an exam.
- A tied vote among the closest remembered moments has no style answer and is not scored.
