# Better Sleep Companion — research demo

A static, offline-first demonstration of a CBT-I companion app for the Better
Sleep Study (Busara Center for Behavioral Economics). Built to be linked from
the DIV Fund Stage 1 application so a reviewer has something to open, not
just a description of an "AI app." Source handoff:
`notes_for_AI/2026-07-18_chat_prompt_cbti_app_demo_build_Son_Extra.md`.

**This is a research demonstration, not a medical device, and it has not had
clinical review.** See "What needs clinical review before this goes public"
below before sharing the link with anyone outside the team.

## What is real versus demonstrated

**Real:**
- The sleep-restriction titration rule (weekly ±15 minutes by sleep
  efficiency, 5-hour floor) is taken directly from
  `field_work/main_intervention/slides/session2_slides.tex`, the Kenya-adapted,
  Sean-Drummond-manual-reviewed session deck actually used in the pilot.
- The nightly diary fields match the validated 8-question pilot instrument,
  `field_work/design_surveys/survey_instruments/Sleep_diary_20260507_v3.pdf`,
  field for field (see "Diary field mapping" below).
- The four session summaries are condensed from the actual session decks
  (`session1_slides.tex` through `session4_slides.tex`), not invented.
- The TIB/TST/sleep-efficiency arithmetic, including midnight-crossing
  handling, is unit-tested (`js/engine.test.js`, run via `tests.html`) against
  cases modeled on real pilot data problems (see "Midnight-crossing" below).

**Demonstrated / simplified, not production-grade:**
- No accounts, no backend, no real user data collection, no Fitbit
  integration, no analytics. Everything lives in this browser's
  `localStorage` and never leaves the device.
- The diary is not tied to real calendar dates. Each save advances an
  internal "night counter" so a reviewer can log several nights in one
  sitting; a production build would key nights to real dates and expect one
  entry per real day.
- The scripted troubleshooter (Mode A) covers 8 topics with a small number
  of diary-state branches each — enough to show the pattern, not the full
  clinical breadth a real deployment would need.
- The safety screener is two yes/no questions asked once at onboarding
  (re-answerable is not exposed in the UI yet); a production build would
  want this reachable and re-askable at any time, and probably prompted
  periodically.
- Mode B (bring-your-own-key) is a thin demo affordance: it calls the
  Anthropic API directly from the browser with the
  `anthropic-dangerous-direct-browser-access` header, which is fine for a
  reviewer pasting their own throwaway key but is explicitly not a pattern
  to ship in a real product (it exposes whatever key is pasted to anyone
  inspecting that browser session). Confirmed reachable end-to-end during
  this build (a deliberately invalid key got a real `401` from the API, not
  a CORS or network failure) — the actual answer quality is untested since
  no valid key was available.

## The deterministic engine (the substantive part)

`js/engine.js` is pure arithmetic and fixed thresholds. No model call ever
decides a sleep window or a safety branch. This is the whole point of the
demo and the thing the DIV application's safety story leans on.

**Nightly derived quantities** (`computeNight`):
- `TIB` (time in bed) = time out of bed − time into bed
- `TST` (total sleep time) = (final wake time − time tried to sleep) − sleep
  onset latency − minutes awake in the night
- `SE` (sleep efficiency) = TST / TIB

This is the standard consensus-sleep-diary convention (Carney et al. 2012):
TIB spans the full got-into-bed-to-got-out-of-bed period, while TST is
counted from sleep onset (tried-to-sleep time + latency) to final wake. The
gap between getting into bed and trying to sleep counts toward TIB but not
TST, which is what makes the diary's Q2/Q3 split (get into bed vs. close
eyes intending to sleep) do real work rather than being redundant. **This
formula choice should be confirmed against Sean Drummond's manual** — the
handoff's own restated formula was a slight simplification of this.

**Midnight-crossing.** Two pilot participants (P817, P238) had a real
digitization bug where a bedtime written just after midnight ("00:15") was
misread as 12:15 pm
(`notes/pilot_2026_05_sleep_trends/2026-06-25_diary_digitization_cleaning.md`).
This app takes 24-hour clock input directly (`<input type=time>`), so that
specific ambiguity cannot recur, but the underlying sequencing problem
still exists: the same night's timestamps (bed → tried to sleep → woke →
out of bed) can numerically cross midnight. `unwrapSequence()` walks the
four timestamps in temporal order and adds 24 hours to any value that would
otherwise go backward. Covered by unit tests including the exact P817/P238
shape.

**Internal-consistency guard, not a hardcoded ceiling.** A night is rejected
as implausible if the arithmetic doesn't add up (negative or
impossibly-large TST relative to TIB), the same way the pilot's own data
cleaning caught P279's impossible 270-minute latency by checking it against
that night's bed and wake times, not by capping SOL at some fixed number.
Rejected nights are excluded from the rolling average, exactly as P279's and
P795's unusable data were excluded from real pilot aggregates, and the app
tells the person their numbers did not add up rather than silently
computing something wrong.

**Weekly titration** (`titrate`), source `session2_slides.tex`:

| Mean SE over last 7 nights (≥5 with data) | Action |
|---|---|
| ≥ 85% | window **extends** 15 minutes |
| 80–85% | window **holds** |
| < 80% | window **shrinks** 15 minutes |

Wake time is the fixed anchor; bedtime is derived. The window is **never
prescribed below 5 hours**, matching the facilitator note on the same slide.
The reference date for "last 7 nights" is the most recent diary entry, not
the device clock — this lets several nights be logged in one sitting (for
this demo) and also tolerates a real participant's diary lagging a day or
two behind, without breaking the calculation either way.

## Safety rules (hard stops, not banners)

Every rule below is coded in `runSafetyChecks()` and rendered by a
full-screen, non-dismissible modal (`SafetyGate` in `js/app.js`) that
requires an explicit acknowledgment tap before the person can continue. None
of these are dismissible banners the person can scroll past.

| Rule | Trigger | Behavior |
|---|---|---|
| Window floor | Prescribed window would go below 5 hours | Clamp to 5 hours; tell the person to speak to the study team |
| Daytime sleepiness, urgent | Any single "dangerously sleepy" diary report | Advise against driving/machinery immediately |
| Daytime sleepiness, sustained | 3+ "very sleepy" reports in trailing 7 nights | Same advisory, framed as a pattern to flag to the facilitator |
| Possible apnea | Onboarding screener: loud snoring + witnessed breathing pauses | Stop giving CBT-I advice; show referral message |
| Self-harm indication | Onboarding screener: thoughts of self-harm or life not worth living | Stop giving CBT-I advice; show referral message; app does not attempt to counsel |

The two screener questions are asked once at onboarding. Tapping either of
the two matching buttons on the Ask screen ("I snore loudly..." /
"...thinking about hurting myself") re-triggers the same gate, so a person
who doesn't disclose at onboarding can still reach the referral pathway
later.

**The self-harm and apnea referral text contains bracketed placeholders**
(`[STUDY TEAM CONTACT — to be filled in before real use]`,
`[LOCAL CRISIS LINE — to be filled in before real use]`) instead of a real
phone number. This was deliberate: a wrong or outdated crisis-line number
shown at the exact moment someone discloses self-harm risk is worse than an
obvious placeholder. **A real, currently-correct contact must replace these
before this is shown to anyone outside the team**, and that substitution
itself should be reviewed, not just typed in.

## What needs Sean Drummond's clinical review before this link goes anywhere near a funder

1. **The TST formula** (sleep onset = tried-to-sleep + latency, distinct
   from time into bed) — confirm this matches the manual's convention.
2. **The titration thresholds and step size** (85% / 80% / ±15 min / 5-hour
   floor) — taken from the session deck, but the deck itself should be
   checked against the manual it was adapted from.
3. **The daytime-sleepiness safety thresholds** (single "dangerous" report;
   3-of-7 "high" reports) — these are demo judgment calls, not sourced from
   the protocol, invented to satisfy the handoff's safety-branch
   requirement. A clinician should set the real thresholds.
4. **The daytime-sleepiness diary question itself** — not part of the
   validated pilot instrument; added here only to make the safety rule
   computable. Sean should confirm the wording and scale are appropriate,
   or replace it with whatever the real protocol would use.
5. **The two-question safety screener wording** (apnea, self-harm) — plain
   non-clinical phrasing was used deliberately, but the actual questions,
   thresholds, and referral pathway should be clinician-approved before any
   real person answers them, even in a demo a reviewer might click through.
6. **The self-harm and apnea referral text**, once the bracketed contact
   placeholders are filled in with real information.
7. **The troubleshooter response library** (`data/troubleshooter.json`) —
   the branching logic is mechanical, but the actual advice text should be
   read end to end by someone clinically qualified before this is treated
   as more than a demo.

## Language and translation

English, Kiswahili, and Sheng are all first-class: the same JSON structure
carries all three, and nothing in Kiswahili or Sheng is a shortened
paraphrase of the English. **No native-speaker or Busara field-team review
of the Kiswahili/Sheng text has happened yet** — this is a linguistic
accuracy check, separate from and in addition to Sean's clinical review
above, and should happen before the link is shared widely.

## Diary field mapping

| App field | Pilot instrument question |
|---|---|
| Nap minutes | Q1: nap minutes yesterday |
| Bed time | Q2: time got into bed |
| Sleep-try time | Q3: time closed eyes intending to sleep |
| Sleep onset latency | Q4: minutes to fall asleep |
| WASO | Q5: minutes awake in the middle of the night |
| Wake time | Q6: final wake time |
| Out-of-bed time | Q7: time got out of bed |
| Interference checklist | Q8: temperature / noise / light / worry (sleep, work, family) / other |

The instrument's free-text "Other: ___" line was deliberately implemented as
a plain checkbox with no text field, so the troubleshooter never has to
parse or render arbitrary user-typed text (kept the branching logic fully
deterministic and avoided an XSS-shaped surface for no real benefit in a
demo). Daytime sleepiness is the one added field beyond the instrument (see
clinical-review item 4 above).

## Do not build (per the handoff, still true)

No accounts, no backend, no real user data collection, no analytics, no
payment, no Fitbit integration, no native app.

## What a production build would add

- Real accounts/auth if needed, or a facilitator-mediated model matching how
  the actual pilot ran (facilitator reads diaries, hands out window cards).
- Diary entries keyed to real calendar dates with a proper "haven't logged
  today yet" reminder flow, not the sequential night-counter used here.
- A safety screener that's reachable and re-askable at any time, not just at
  onboarding, and probably a periodic re-check.
- A much larger, clinician-authored troubleshooter library, ideally the
  Level 1 golden dataset this structure is meant to seed (50 real sleep
  problems with known-correct responses, per the DIV application's Q4 eval
  plan).
- A real BYOK/generative layer pattern that does not expose the key to the
  browser session (a thin proxy, still with no keys in client code — the
  DIV application's actual production design, not this demo's shortcut).
- Analytics-free but facilitator-visible progress tracking, matching how the
  real 4-session group program hands out physical window cards today.

## Running locally

No build step. Any static file server works:

```
python3 -m http.server 8765
```

Then open `http://localhost:8765/index.html`. Open `tests.html` for the
engine unit tests (28 assertions covering midnight-crossing, titration
boundaries, and safety-check wiring).

## Repo hygiene

No participant data, real diary entries, or anything identifying is in this
folder or the deployed repo. All example values used during development
were synthetic.
