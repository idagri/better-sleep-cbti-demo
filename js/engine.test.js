// In-browser unit tests for engine.js. Open tests.html to run these.
// No test framework and no build step: a tiny hand-rolled runner keeps this
// static-hostable, matching the rest of the demo.
import * as E from './engine.js';

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message || String(err) });
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg || 'assertClose failed'}: expected ~${expected}, got ${actual}`);
  }
}

function assertTrue(actual, msg) {
  if (!actual) throw new Error(msg || 'expected true, got false');
}

// --- timeStrToMinutes / minutesToTimeStr ---

test('timeStrToMinutes parses 24h HH:MM', () => {
  assertEqual(E.timeStrToMinutes('00:00'), 0);
  assertEqual(E.timeStrToMinutes('23:59'), 1439);
  assertEqual(E.timeStrToMinutes('06:30'), 390);
});

test('timeStrToMinutes rejects invalid input', () => {
  assertEqual(E.timeStrToMinutes(''), null);
  assertEqual(E.timeStrToMinutes(null), null);
  assertEqual(E.timeStrToMinutes('25:00'), null);
  assertEqual(E.timeStrToMinutes('12:60'), null);
});

test('minutesToTimeStr round-trips and wraps negative/over-1440', () => {
  assertEqual(E.minutesToTimeStr(390), '06:30');
  assertEqual(E.minutesToTimeStr(-30), '23:30');
  assertEqual(E.minutesToTimeStr(1440 + 45), '00:45');
});

// --- unwrapSequence: the midnight-crossing fix ---
// Directly modeled on the pilot bug: P817/P238 wrote bedtimes just after
// midnight (e.g. "00:15") which the first digitization pass misread as
// 12:15 pm (notes/pilot_2026_05_sleep_trends/2026-06-25_diary_digitization_cleaning.md).
// This app takes 24h input directly, so the failure mode here is different:
// the sequence bed -> tried-to-sleep -> wake -> out-of-bed must be unwrapped
// forward whenever a later step's clock value is numerically smaller.

test('unwrapSequence: ordinary night, no midnight crossing', () => {
  // bed 22:00, tried 22:15, woke 06:00, out of bed 06:10
  const out = E.unwrapSequence([1320, 1335, 360, 370]);
  assertEqual(out[0], 1320);
  assertEqual(out[1], 1335);
  assertEqual(out[2], 360 + 1440);
  assertEqual(out[3], 370 + 1440);
});

test('unwrapSequence: bedtime itself after midnight', () => {
  // bed 00:15 (after midnight), tried 00:30, woke 06:00, out of bed 06:15
  // all read as later-in-the-clock-day than a naive same-day assumption
  // would give if the previous night's reference matters; here they are
  // already monotonically increasing so no wrap should be added.
  const out = E.unwrapSequence([15, 30, 360, 375]);
  assertEqual(out[0], 15);
  assertEqual(out[1], 30);
  assertEqual(out[2], 360);
  assertEqual(out[3], 375);
});

test('unwrapSequence: bed before midnight, tried-to-sleep after midnight', () => {
  // bed 23:50, tried 00:10 (20 minutes later, crossing midnight), woke 06:00, out 06:05
  const out = E.unwrapSequence([1430, 10, 360, 365]);
  assertEqual(out[0], 1430);
  assertEqual(out[1], 1440 + 10); // 1450
  assertEqual(out[2], 1440 + 360);
  assertEqual(out[3], 1440 + 365);
});

test('unwrapSequence: preserves nulls without breaking the chain', () => {
  const out = E.unwrapSequence([1320, null, 360, 370]);
  assertEqual(out[1], null);
  assertEqual(out[2], 360 + 1440);
});

// --- computeNight: TIB/TST/SE with midnight crossing ---

test('computeNight: straightforward night matches hand computation', () => {
  // bed 22:00, tried 22:15, SOL 20, WASO 10, woke 05:45, out 06:00
  const r = E.computeNight({
    bedTime: '22:00',
    sleepTryTime: '22:15',
    solMin: 20,
    wasoMin: 10,
    wakeTime: '05:45',
    outOfBedTime: '06:00',
    napMin: 0,
  });
  assertTrue(r.valid, 'expected valid night');
  // TIB = out(06:00 next day) - bed(22:00) = 8h = 480 min
  assertEqual(r.TIB, 480);
  // sleep attempt span = wake(05:45+1440) - tried(22:15) = 7.5h = 450 min
  // TST = 450 - 20 - 10 = 420
  assertEqual(r.TST, 420);
  assertClose(r.SE, 420 / 480, 1e-9);
});

test('computeNight: post-midnight bedtime (the P817/P238 case) still yields correct TIB', () => {
  // bed 00:15 (after midnight), tried 00:20, SOL 15, WASO 0, woke 06:00, out 06:10
  const r = E.computeNight({
    bedTime: '00:15',
    sleepTryTime: '00:20',
    solMin: 15,
    wasoMin: 0,
    wakeTime: '06:00',
    outOfBedTime: '06:10',
    napMin: 0,
  });
  assertTrue(r.valid, 'expected valid night');
  assertEqual(r.TIB, 355); // 06:10 - 00:15 = 5h55m = 355 min
  assertEqual(r.TST, 325); // (06:00-00:20=340) - SOL 15 - WASO 0 = 325
});

test('computeNight: rejects an internally impossible entry (P279-style)', () => {
  // bed 02:00, tried 02:00, SOL 270 (4.5h), WASO 0, woke 06:40, out 06:45
  // sleep attempt span = 06:40 - 02:00 = 280 min, minus SOL 270 leaves only
  // 10 min of possible sleep before WASO is even considered; push SOL up
  // further so it is flatly impossible.
  const r = E.computeNight({
    bedTime: '02:00',
    sleepTryTime: '02:00',
    solMin: 270,
    wasoMin: 60,
    wakeTime: '02:30', // less than an hour after bed: SOL+WASO alone exceed it
    outOfBedTime: '02:40',
    napMin: 0,
  });
  assertTrue(!r.valid, 'expected an implausible night to be rejected, not silently computed');
  assertEqual(r.reason, 'implausible');
});

test('computeNight: incomplete entry is flagged, not defaulted', () => {
  const r = E.computeNight({
    bedTime: '22:00',
    sleepTryTime: '',
    solMin: 10,
    wasoMin: 0,
    wakeTime: '06:00',
    outOfBedTime: '06:10',
  });
  assertTrue(!r.valid);
  assertEqual(r.reason, 'incomplete');
});

// --- titrate: weekly rule boundaries ---

function nightsWithSE(seArray) {
  return seArray.map((SE) => ({ SE }));
}

test('titrate: fewer than 5 valid nights holds and reports insufficient_data', () => {
  const r = E.titrate(360, nightsWithSE([0.9, 0.9, 0.9, 0.9]));
  assertEqual(r.action, 'insufficient_data');
  assertEqual(r.newWindowMin, 360);
});

test('titrate: mean SE exactly 0.85 extends by 15', () => {
  const r = E.titrate(360, nightsWithSE([0.85, 0.85, 0.85, 0.85, 0.85]));
  assertEqual(r.action, 'extend');
  assertEqual(r.newWindowMin, 375);
});

test('titrate: mean SE just under 0.85 holds', () => {
  const r = E.titrate(360, nightsWithSE([0.849, 0.849, 0.849, 0.849, 0.849]));
  assertEqual(r.action, 'hold');
  assertEqual(r.newWindowMin, 360);
});

test('titrate: mean SE exactly 0.80 holds (boundary is inclusive on the hold side)', () => {
  const r = E.titrate(360, nightsWithSE([0.80, 0.80, 0.80, 0.80, 0.80]));
  assertEqual(r.action, 'hold');
  assertEqual(r.newWindowMin, 360);
});

test('titrate: mean SE just under 0.80 reduces by 15', () => {
  const r = E.titrate(360, nightsWithSE([0.79, 0.79, 0.79, 0.79, 0.79]));
  assertEqual(r.action, 'reduce');
  assertEqual(r.newWindowMin, 345);
});

test('titrate: never prescribes below the 5-hour floor', () => {
  const r = E.titrate(310, nightsWithSE([0.5, 0.5, 0.5, 0.5, 0.5]));
  assertEqual(r.action, 'reduce');
  assertEqual(r.newWindowMin, 300);
  assertTrue(r.clamped);
});

test('titrate: floor clamp also applies exactly at 300+15-15 boundary', () => {
  const r = E.titrate(300, nightsWithSE([0.79, 0.79, 0.79, 0.79, 0.79]));
  assertEqual(r.newWindowMin, 300);
  assertTrue(r.clamped);
});

// --- prescribeBedtime ---

test('prescribeBedtime: wraps correctly across midnight', () => {
  assertEqual(E.prescribeBedtime('05:30', 6 * 60), '23:30');
  assertEqual(E.prescribeBedtime('06:00', 5 * 60), '01:00');
});

// --- safety checks ---

test('checkWindowFloor triggers only at or below the floor', () => {
  assertTrue(E.checkWindowFloor(300));
  assertTrue(!E.checkWindowFloor(315));
});

test('checkSustainedSleepiness: single dangerous report triggers urgent', () => {
  const r = E.checkSustainedSleepiness([{ sleepiness: 'none' }, { sleepiness: 'dangerous' }]);
  assertTrue(r.triggered);
  assertEqual(r.level, 'urgent');
});

test('checkSustainedSleepiness: three high reports in 7 nights trigger sustained', () => {
  const entries = [
    { sleepiness: 'high' }, { sleepiness: 'none' }, { sleepiness: 'high' },
    { sleepiness: 'mild' }, { sleepiness: 'high' }, { sleepiness: 'none' }, { sleepiness: 'none' },
  ];
  const r = E.checkSustainedSleepiness(entries);
  assertTrue(r.triggered);
  assertEqual(r.level, 'sustained');
});

test('checkSustainedSleepiness: two high reports do not trigger', () => {
  const entries = [{ sleepiness: 'high' }, { sleepiness: 'high' }, { sleepiness: 'none' }];
  const r = E.checkSustainedSleepiness(entries);
  assertTrue(!r.triggered);
});

test('runSafetyChecks: apnea surfaces on its own', () => {
  const events = E.runSafetyChecks({
    windowMin: 360,
    diaryEntries: [],
    screener: { snoringApnea: true },
  });
  assertEqual(events[0].code, 'apnea');
});

test('runSafetyChecks: window at floor surfaces a refer event', () => {
  const events = E.runSafetyChecks({ windowMin: 300, diaryEntries: [], screener: {} });
  assertTrue(events.some((e) => e.code === 'window_floor'));
});

test('runSafetyChecks: clean state surfaces nothing', () => {
  const events = E.runSafetyChecks({ windowMin: 390, diaryEntries: [{ sleepiness: 'none' }], screener: {} });
  assertEqual(events.length, 0);
});

// --- initialWindowFromBaseline ---

test('initialWindowFromBaseline rounds to the nearest 15 minutes', () => {
  const nights = [{ TST: 383 }, { TST: 391 }, { TST: 399 }]; // mean 391
  assertEqual(E.initialWindowFromBaseline(nights), 390); // nearest 15 to 391
});

test('initialWindowFromBaseline floors at the 5-hour minimum', () => {
  const shortNights = [{ TST: 120 }]; // well under the floor
  assertEqual(E.initialWindowFromBaseline(shortNights), 300);
});

export { results };
