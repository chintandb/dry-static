# DRY STATIC

A dry apnea table trainer for freedivers that uses the camera to check each hold.

Freedivers train breath-holds on land with CO2 and O2 tables: a fixed series of timed holds and rests, done seated or lying down. Most table apps are a stopwatch, and nothing checks the hold itself. A small breath, a pause to talk, or a lost camera view all pass unnoticed. DRY STATIC reads the breathing traces from the Presage SmartSpectra SDK and uses them for three things: it checks that each hold stayed still, it marks diaphragm contractions (experimental), and it shows how your pulse changed after each hold.

It is a desktop app built with Electron and TypeScript. It runs on macOS with Apple Silicon and needs Node.js 20 or newer.

Demo video (2:54): [docs/demo.mp4](docs/demo.mp4). It plays the bundled synthetic recording at 4x speed, then shows the analyzer output from a real session of three holds.

## Quick start

You need a Presage API key. A free one is available at https://physiology.presagetech.com/auth/register.

```bash
npm install
cp .env.example .env    # then set PRESAGE_API_KEY in .env
npm start
```

`npm start` builds the app and opens it. If npm skipped Electron's install script, the build downloads the Electron binary once (`scripts/ensure-electron.mjs`). The key is read from the `PRESAGE_API_KEY` environment variable first, then from `.env`. The app never logs it, shows it, or writes it into a recording.

The camera stays off until you agree on the first screen, check all six boxes on the safety screen, and press Start framing on the setup screen.

## Try it without a key

```bash
npm install
npm run replay
```

Then choose "Try replay (no camera, no key)". This plays `recordings/demo-1.jsonl` at 4x speed through the same screens and detectors as a live session, in about a minute and a half.

That recording is synthetic. `scripts/demo.ts` generated it (`npm run demo` rebuilds it) to exercise the detectors: three 45 s holds, one with a sneaked breath in round 2, and a pulse drop of 7 BPM per hold. It is not a measurement of a person, and the app says so on the settle and end screens. Stop and Space taps are disabled during replay.

## How a session works

1. **Setup.** Enter your current personal best static (30 to 600 s), pick a CO2 or O2 table, a size (Quick 3 rounds, Standard 5, Full 8) and a hold cap of 50%, 55% or 60% of your personal best. Holds never go above the cap, and the shortest hold is 15 s. A CO2 table keeps the hold fixed and shortens the rest (from 60 s by 10 s per round on Quick, from 90 s by 15 s otherwise, never below 30 s). An O2 table keeps the rest fixed (60 s on Quick, 90 s otherwise) and grows the hold from 60% of the cap up to the cap. For example, a 90 s personal best on a Quick CO2 table at 50% gives three 45 s holds with rests of 60, 50 and 40 s, about 5:39 in total.
2. **Framing.** Sit back so the camera sees your chest and waist. Continue unlocks once the SDK has reported a good view for 3 s and both breathing traces are arriving.
3. **Settle-in (45 s).** Breathe normally without talking. The app measures your normal breathing amplitude from the last 30 s. If neither trace is clean enough, it sends you back to framing.
4. **Rounds.** Rest, a 3 s countdown, then the hold. During the hold you see a status chip (HOLD VERIFIED, BREATH DETECTED or NOT READABLE), the live breathing trace, auto marks and your Space taps. Pulse is hidden during holds.
5. **End.** One strip per round with the trace, marks, taps and pulse, up to three summary sentences, and CSV or PNG export.

Stop (the button, S or Esc) means different things by phase. During a hold it ends the hold, which is kept as "stopped at M:SS". During the countdown it cancels that hold. During a rest it ends the session; finished rounds are kept.

## What the camera signals are used for

| SDK signal | Use |
|---|---|
| Chest and abdomen breathing traces | The cleaner one (higher signal-to-noise) is used to verify holds and is drawn live |
| Abdomen breathing trace | Contraction marks (the chest trace is used if the abdomen trace is too noisy) |
| Talking | Any talking makes that part of the hold unreadable |
| Validation status | Framing hints; a bad state for more than 1.5 s makes the hold unreadable |
| Pulse rate | Start and low point per hold, shown only after the hold |
| Breathing rate | Shown during rests |

If the key is not allowed to use pulse or talking, the app retries once with the breathing signals only.

**Hold verification.** The first 8 s of a hold are ignored: on a real recording the chest kept settling for 5 to 8 s after the last breath before the hold. After that, a stretch of the hold is unreadable when no sample arrives for more than 1.5 s, when the SDK's validation status is not OK for more than 1.5 s (a bad state that was already present when the hold began counts too), or when the SDK reports talking. A breath is flagged when the smoothed trace moves away from its baseline, in either direction, by more than 0.4 times your settle-in amplitude and stays there for at least 0.4 s. The baseline is a trailing median of the previous 12 s, so a one-sided dip from a quick exhale and re-inhale is not averaged away. A contraction can move the chest about as much as a small breath, so a short movement (2.5 s or less) is not counted as a breath when you tapped `c` from 1.5 s before it to 3 s after it. The live chip waits those 3 s before it shows BREATH DETECTED for a short movement, and the round summary lists every movement that a tap excused. A hold ends as `verified` (no breath, readable for at least 90% of the time), `breath detected`, or `partly readable` with the readable share.

**Contraction marks (experimental).** The detector removes slow drift from the abdominal trace (2 s moving median), takes a 0.5 s RMS envelope, and uses the median envelope from 3 to 10 s into the hold as the baseline. From 10 s on, a mark fires when the envelope rises above 3 times that baseline (and at least 0.1 times the settle-in amplitude), with at least 2 s between marks and none inside unreadable stretches. Each mark is matched one-to-one to a Space tap within 1.5 s, and the end screen reports how many agreed.

**Pulse.** The SDK's pulse is a 12 s average, so it lags. The app shows the last stable value before the hold and the lowest stable value from the start of the hold to 10 s after it ends. Until that window has filled, the line reads "pulse: settling". Values outside 40 to 110 BPM are shown as "outside the SDK's valid range", not as a number.

## Measurements and limits

The detectors have been checked on synthetic data and on one real session of three holds (21 Nov 2026, results in [docs/BENCHMARK.md](docs/BENCHMARK.md#results)). Measuring them on a person takes two scripts: `npm run record` captures holds from the camera with keyboard marks, and `npm run analyze` runs the same detectors over the files and applies four checks. [docs/BENCHMARK.md](docs/BENCHMARK.md) has the steps and the thresholds.

This is the current output for the bundled synthetic recording (`npm run analyze -- recordings/demo-1.jsonl`):

```text
== recordings/demo-1.jsonl
   cadence 27.5 Hz, bad lines 0, invalid 0.0%
   delay 73 ms median, 73 ms p95 (jitter above the fastest packet)
   calibration: primary lower (SNR 9.8), contraction trace lower
   round 1: 45.0 s hold, verified (readable 100.0%), coverage 100.0%, max gap 0.04 s
     marks 2 vs taps 2 (2 matched, precision 1.00, recall 1.00)
     pulse start 72.0 BPM, min 65.0 BPM, delta -7.0 BPM; confidence back after 0.0 s
   round 2: 45.0 s hold, breath_detected (readable 100.0%), coverage 100.0%, max gap 0.04 s
     breath seen at 235.0 s
     marks 4 vs taps 2 (2 matched, precision 0.50, recall 1.00)
     pulse start 65.0 BPM, min 58.0 BPM, delta -7.0 BPM; confidence back after 0.0 s
   round 3: 45.0 s hold, verified (readable 100.0%), coverage 100.0%, max gap 0.04 s
     marks 3 vs taps 3 (3 matched, precision 1.00, recall 1.00)
     pulse start 58.0 BPM, min 51.0 BPM, delta -7.0 BPM; confidence back after 0.0 s
holds: 3
(a) verified-hold signal quality: PASS
(b) contraction marks vs taps: PASS — 7 matched of 9 marks and 7 taps
(c) pulse drop across holds: PASS
(d) breathing confidence recovery: PASS
ship: GO
```

These numbers show the pipeline works end to end. The generator chose the breath, the contraction times and the pulse drop, so they say nothing about how the detectors do on a real body.

| | Synthetic recording | Real person |
|---|---|---|
| Hold verdicts | 3 of 3 match what the generator placed | 3 of 3 real holds verified (after the 8 s settle window and the tap rule; the first version flagged all 3) |
| Contraction marks vs taps | precision 0.78, recall 1.00 (7 of 9 marks, 7 taps) | 0 of 6 taps matched (waist out of frame, chest trace only) |
| Pulse drop per hold | -7 BPM (generated) | -7.7 and -17.3 BPM (round 1 had no pulse before the hold) |

## Privacy and data

- Everything is stored locally, in the app's data folder (`~/Library/Application Support/dry-static/data`; About & Data shows the exact path):
  - `sessions/`: one summary per session (plan, per-round verdicts, marks, taps, pulse values, signal quality).
  - `recordings/`: for live sessions, the signal values the SDK returned, validation codes and hints, and the timing of phases and taps.
  - `usage.json`: the live minutes used on this Mac, shown on the setup screen as a count against the ~50 minute free trial. The app cannot see the real balance.
- No video, images or face data are stored.
- "Delete all data" (on History and on About & Data) removes the whole data folder.
- CSV and PNG exports are written only to a file you choose in the save dialog.
- The SDK processes the camera feed and contacts Presage for authentication and processing. That is the SDK's own traffic. Telemetry is off (`enableTelemetry: false`), the app requests no Presage cloud insights, and it makes no other network requests. Nothing is shared with anyone else.
- The app grants camera access (video only, no microphone) to its own bundled page and denies other permission requests. The renderer is sandboxed with context isolation, and the window blocks navigation and pop-ups.

## Safety

DRY STATIC is a training aid for dry breath-hold practice. It is not a medical device. It does not measure oxygen or carbon dioxide, it cannot detect a blackout, and it is not a safety device. Never use it in or near water. People with heart, lung, blood-pressure or seizure conditions, and anyone pregnant, should talk to a doctor before starting breath-hold training. SmartSpectra metrics are for general wellness and informational purposes only and have not been cleared by the FDA.

## Limitations

- macOS on Apple Silicon only. It has not been tested anywhere else.
- Hold verification and contraction marks are tuned on synthetic traces. Neither has been measured on a person yet.
- A breath smaller than 0.4 times your normal breathing amplitude is not flagged, and neither is one in the first 8 s of a hold or inside a signal gap.
- A short breath right next to a `c` tap is not flagged. The round summary still lists it, so the check is honest only if you tap `c` for real contractions.
- Contraction marks are experimental. Your Space taps remain the reference.
- It needs your chest and waist in view, light in front of you, and you sitting still.
- Live sessions need a network connection and use trial minutes on your key.
- The 50 to 60% hold cap is deliberately low. There is no maximum-attempt mode.

## Development

```bash
npm test              # vitest; no camera or key needed
npm run typecheck     # tsc --noEmit
npm run demo          # regenerate recordings/demo-1.jsonl (synthetic)
npm run synth -- recordings/synthetic-1.jsonl 3   # another synthetic recording, seed 3
```

- `src/core/`: plain TypeScript with no DOM, SDK or Electron: table planning, calibration, hold verification, contractions, pulse, the session state machine and the benchmark. Every tunable number is in `params.ts` and all user-facing text is in `copy.ts`.
- `src/main/`: Electron main process, `.env` loading, local storage.
- `src/renderer/`: the UI in plain DOM and canvas, the live SDK source and the replay source.
- `scripts/`: build, recorder, analyzer, synthetic generators.
- `test/`: unit and screen tests.

## License

MIT. See [LICENSE](LICENSE).
