# Benchmark

How to measure the hold verifier, the contraction marks and the pulse readout on a real person, and what the analyzer counts as a pass.

## Results

No recording of a real person has been analyzed yet. Every number published for this project so far comes from the synthetic file `recordings/demo-1.jsonl`, which `scripts/demo.ts` generates. On that file all four checks pass, which only shows the pipeline is wired correctly. The full output is in the [README](../README.md#measurements-and-limits).

When real recordings exist, their full `npm run analyze` output goes here, unedited, with the date and the setup (light, clothing, camera position).

## Recording three holds

`npm run record` is a headless recorder. It requests the same signals as the app, with telemetry off, and writes the same JSONL format. It needs `PRESAGE_API_KEY` in `.env` or the environment.

Before you start:

- Stay on dry land, seated or lying down, with someone nearby who knows what you are doing.
- Do not hyperventilate before a hold, and stop at the first strong urge to breathe.
- Keep each hold within what the app would plan for you: 50 to 60% of your personal best.
- Have your chest and waist in view, light in front of you, and plain, light clothing.

Optionally, check the SDK's packet shape first. This prints the first decoded packet and exits:

```bash
npm run record -- --inspect --out rec/inspect.jsonl --seconds 20
```

If the field names differ from the ones `rawFromDecoded` reads in `src/core/normalize.ts`, the recorder writes empty traces and that function needs fixing first.

Then record one file per hold:

```bash
npm run record -- --out rec/hold1.jsonl --seconds 180
npm run record -- --out rec/hold2.jsonl --seconds 180
npm run record -- --out rec/hold3.jsonl --seconds 180
```

Keys (no Enter needed):

| Key | Meaning |
|---|---|
| `s` | hold start |
| `c` | contraction felt |
| `e` | hold end |
| `q` | quit and save |

Notes:

- Breathe normally and stay quiet for at least 30 s before pressing `s`. The analyzer calibrates on the 30 s before the first hold start.
- Tap `c` at every contraction you feel. Check (b) needs at least 6 taps across all files.
- Keep recording for at least 40 s after `e`. The pulse window runs to 10 s after the hold, and check (d) looks for the breathing signal to settle again.
- `--seconds` is a hard stop (default 300). The recorder appends to an existing file, so use a new file name for each run.
- While it runs, the recorder prints one status line a second: elapsed time, packet count, trace cadence, and the latest pulse and breathing rate.
- `rec/` is in `.gitignore`. Recordings hold signal values and status codes, never video.

## Running the analyzer

```bash
npm run analyze -- rec/hold1.jsonl rec/hold2.jsonl rec/hold3.jsonl
```

For each file it prints cadence, delivery delay, the share of time with a bad validation status, which trace calibration picked, and per hold: duration, verdict, readable share, coverage, largest gap, contraction marks against your taps, pulse start and low point, and how long the breathing rate took to become stable again. It finishes with the four checks below. Contraction results are pooled across all files.

## Checks

The thresholds are in `goNoGo()` in `src/core/benchmark.ts`. They were fixed before any real data was recorded.

| Check | Measured | PASS | PARTIAL | Otherwise |
|---|---|---|---|---|
| (a) Signal during holds | Coverage (share of each hold, from 3 s in, that lies between samples at most 1.5 s apart), largest gap, trace cadence | worst hold coverage at least 90%, largest gap at most 1.0 s, and slowest file at least 20 Hz | worst coverage at least 60% | FAIL (also when no hold was found) |
| (b) Contraction marks vs taps | Marks matched one-to-one to `c` taps within 1.5 s, pooled | precision at least 0.70 and recall at least 0.50 | precision at least 0.60 and recall at least 0.30 | FAIL; INCONCLUSIVE with fewer than 6 taps |
| (c) Pulse drop | Lowest stable pulse from hold start to 10 s after, minus the last stable pulse before the hold | a drop of 3 BPM or more in at least 2 holds | any other result | |
| (d) Breathing confidence recovery | Time from hold end to the first stable breathing-rate sample | median at most 40 s | any other result, or no stable sample | |

The last line, `ship:`, reads `NO-GO` only when check (a) fails. Without a usable signal during holds, the app's hold verdicts mean nothing. Checks (b), (c) and (d) only affect labels and parameters:

- The label on auto marks is `autoMarksLabel` in `src/core/params.ts`. It is `experimental` today, and `hidden` removes the marks from the round screen.
- If real recordings disagree with the defaults, the parameters to adjust are `breathFrac`, `envelopeK` and `envelopeAbsFrac` in `src/core/params.ts`, each within 50% of its current value. Any change should be listed here with the before and after output.
