# Laya shadow logging and training export

## Files

- `src/laya/shadow.ts`: splits Jev decisions by pilot, sends independent Laya requests, and records successful replies.
- `src/laya/rows.ts`: stores capped, chunked rows and exports JSON Lines.
- `src/laya/shadow.test.ts`: covers request splitting, row shape, stable IDs, failures, in-flight limits, export, and the Jev tally boundary.
- `src/config.laya.test.ts`: covers saved settings and defaults.

## Exports

- `createShadow` records each Jev decision and sends at most one request per pilot at a time.
- `createRows` appends and updates rows. Its `attachHuman(rowId, answers)` method records a later correction.
- `attachHuman(rowId, answers)` uses the current runtime's row store for later lesson code.
- `rowId` derives a stable ID from the install ID, run ID, decision sequence, and fixed pilot slot.
- `allRows`, `countRows`, and `exportRows(store)` read rows across runs. `exportRows` returns JSON Lines with a trailing newline.
- `Runtime.exportLayaRows()` and `Runtime.layaRowCount()` serve Setup.

## Changes outside `src/laya/`

- `src/config.ts`: added `layaShadow`, off by default, and tolerant envelope reading.
- `src/runtime.ts`: starts row logging from the decision record and exposes export and count methods.
- `src/ui/setup.ts`: added the shadow switch, server address, saved row count, and download control.
- `src/config.laya.test.ts`: tests the config addition.
- `src/manifest-capabilities.test.ts` already ties the existing player-typed `serverUrl` to `network:local`, so it needed no change.

## Judgment calls

- A decision's two row numbers are `sequence * 2` and `sequence * 2 + 1`. Both IDs stay stable after reload and fit the `squire-<install>-<run>-<n>` form.
- Rows use 100 entries per chunk and retain at most 50 chunks per run, so a run holds at most 5,000 rows. Old chunks are deleted without renumbering later rows.
- A failed or skipped shadow request leaves its Jev row without a `laya` field. The first shadow failure in a session reaches the host log; later failures stay quiet.
- Export waits for pending teacher row writes, but does not wait for a Laya network reply.

## Verification

- `pnpm typecheck` passed.
- `pnpm exec vitest run` passed.
