// Deterministic CBT-I sleep-restriction engine.
// No inference, no model calls. Every value here is arithmetic or a fixed
// rule threshold. See README.md for the clinical source of each rule and
// what still needs Sean Drummond's review.

// ---------------------------------------------------------------------
// Time parsing and midnight-crossing arithmetic
// ---------------------------------------------------------------------

// "HH:MM" (24h, from <input type=time>) -> minutes since local midnight, or null.
export function timeStrToMinutes(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const parts = String(hhmm).split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToTimeStr(totalMin) {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Takes clock times in known temporal order (e.g. bed -> tried-to-sleep ->
// woke -> out of bed) and "unwraps" each one forward past midnight as many
// times as needed to stay >= the previous value. This is the fix for the
// post-midnight bedtime bug found in the pilot diaries (P817, P238: a
// bedtime written as "12:15" meaning 00:15 the next calendar day was
// digitized as 12:15 pm). Because this app collects times with a 24-hour
// <input type=time> picker there is no am/pm ambiguity at entry, but the
// sequence can still cross midnight, so the unwrap is still required.
export function unwrapSequence(rawMinutesArray) {
  const out = [];
  let prev = null;
  for (const raw of rawMinutesArray) {
    if (raw == null) {
      out.push(null);
      continue;
    }
    let m = raw;
    if (prev !== null) {
      let guard = 0;
      while (m < prev) {
        m += 1440;
        guard += 1;
        if (guard > 3) break; // defensive: refuse to unwrap more than 3 days
      }
    }
    out.push(m);
    prev = m;
  }
  return out;
}

// ---------------------------------------------------------------------
// Nightly derived quantities
// ---------------------------------------------------------------------
//
// Field names follow the pilot's validated 8-question diary
// (field_work/design_surveys/survey_instruments/Sleep_diary_20260507_v3.pdf):
//   Q2 bedTime       - time got into bed
//   Q3 sleepTryTime  - time closed eyes intending to sleep
//   Q4 solMin        - minutes to fall asleep (sleep onset latency)
//   Q5 wasoMin        - minutes awake in the middle of the night
//   Q6 wakeTime      - final wake time
//   Q7 outOfBedTime  - time got out of bed
//   Q1 napMin        - nap minutes the prior day
//
// TIB (time in bed) spans the full got-into-bed to got-out-of-bed period.
// TST (total sleep time) spans sleep onset (tried-to-sleep + SOL) to final
// wake, minus WASO. This is the standard consensus-sleep-diary convention
// (Carney et al. 2012) and is what makes Q2 and Q3 distinct fields do real
// work: time spent in bed before trying to sleep counts toward TIB (and so
// lowers sleep efficiency) but not toward TST. This formula choice should
// be confirmed against Sean Drummond's manual during clinical review.
export function computeNight(entry) {
  const rawClock = [entry.bedTime, entry.sleepTryTime, entry.wakeTime, entry.outOfBedTime]
    .map(timeStrToMinutes);
  const solMin = Number(entry.solMin);
  const wasoMin = Number(entry.wasoMin);

  if (rawClock.some((v) => v == null) || !Number.isFinite(solMin) || !Number.isFinite(wasoMin)) {
    return { valid: false, reason: 'incomplete' };
  }
  if (solMin < 0 || wasoMin < 0) {
    return { valid: false, reason: 'negative_duration' };
  }

  const [bed, sleepTry, wake, outOfBed] = unwrapSequence(rawClock);
  const TIB = outOfBed - bed;
  const sleepAttemptSpan = wake - sleepTry;
  const TST = sleepAttemptSpan - solMin - wasoMin;

  // Internal-consistency guard, not a hardcoded value ceiling. This is how
  // the pilot's own data cleaning caught an impossible entry (P279: a
  // 270-minute latency that could not fit between the reported bed and
  // wake times) rather than by capping SOL at some arbitrary number.
  if (TIB <= 0 || TIB > 20 * 60 || TST < 0 || TST > TIB) {
    return { valid: false, reason: 'implausible', TIB, TST };
  }

  const SE = TST / TIB;
  const napMin = Number.isFinite(Number(entry.napMin)) ? Math.max(0, Number(entry.napMin)) : 0;

  return {
    valid: true,
    TIB,
    TST,
    SE,
    napMin,
    bed,
    sleepTry,
    wake,
    outOfBed,
  };
}

// ---------------------------------------------------------------------
// Weekly titration rule
// ---------------------------------------------------------------------
// Source: field_work/main_intervention/slides/session2_slides.tex
// ("Your window for this week": >=85% SE -> +15 min; 80-84.9% -> hold;
// <80% -> -15 min; facilitator note repeats the same thresholds and the
// 5-hour floor). Requires at least 5 nights with valid data in the
// trailing 7 to compute an adjustment.
export const MIN_WINDOW_MIN = 5 * 60;
export const SE_EXTEND_THRESHOLD = 0.85;
export const SE_REDUCE_THRESHOLD = 0.80;
export const STEP_MIN = 15;
export const MIN_NIGHTS_REQUIRED = 5;
export const LOOKBACK_NIGHTS = 7;

export function titrate(currentWindowMin, validNightsLast7) {
  if (validNightsLast7.length < MIN_NIGHTS_REQUIRED) {
    return {
      action: 'insufficient_data',
      meanSE: null,
      nightsUsed: validNightsLast7.length,
      newWindowMin: currentWindowMin,
      clamped: false,
    };
  }

  const meanSE = validNightsLast7.reduce((sum, n) => sum + n.SE, 0) / validNightsLast7.length;

  let action = 'hold';
  let delta = 0;
  if (meanSE >= SE_EXTEND_THRESHOLD) {
    action = 'extend';
    delta = STEP_MIN;
  } else if (meanSE < SE_REDUCE_THRESHOLD) {
    action = 'reduce';
    delta = -STEP_MIN;
  }

  let newWindowMin = currentWindowMin + delta;
  let clamped = false;
  if (newWindowMin < MIN_WINDOW_MIN) {
    newWindowMin = MIN_WINDOW_MIN;
    clamped = true;
  }

  return { action, meanSE, nightsUsed: validNightsLast7.length, newWindowMin, clamped };
}

// Wake time is the fixed anchor; bedtime is derived from it and the window.
export function prescribeBedtime(wakeTimeStr, windowMin) {
  const wake = timeStrToMinutes(wakeTimeStr);
  if (wake == null) return null;
  return minutesToTimeStr(wake - windowMin);
}

// Establish the first window from baseline diary nights (mirrors Session 1:
// "your time in bed now, your time asleep now, your new sleep window").
// Uses the mean observed TST over the baseline nights, rounded to the
// nearest 15 minutes, floored at MIN_WINDOW_MIN.
export function initialWindowFromBaseline(validBaselineNights) {
  if (validBaselineNights.length === 0) return null;
  const meanTST = validBaselineNights.reduce((s, n) => s + n.TST, 0) / validBaselineNights.length;
  const rounded = Math.round(meanTST / 15) * 15;
  return Math.max(MIN_WINDOW_MIN, rounded);
}

// ---------------------------------------------------------------------
// Safety rules. Every one of these is a hard stop in the UI layer, not a
// dismissible banner: see app.js `SafetyGate`. Thresholds below are demo
// choices standing in for clinical judgment and MUST be reviewed by Sean
// Drummond before this is shared with anyone outside the team (see
// README.md "What needs clinical review").
// ---------------------------------------------------------------------

export function checkWindowFloor(windowMin) {
  return windowMin <= MIN_WINDOW_MIN;
}

// "Sustained excessive daytime sleepiness": any single "dangerous" report
// (fell asleep or came close while doing something safety-critical) is an
// immediate flag; three or more "high" reports in the trailing week is a
// sustained pattern. Demo thresholds, not sourced from the protocol.
export function checkSustainedSleepiness(diaryEntries) {
  const last7 = diaryEntries.slice(-LOOKBACK_NIGHTS);
  const dangerousCount = last7.filter((e) => e.sleepiness === 'dangerous').length;
  const highOrDangerousCount = last7.filter(
    (e) => e.sleepiness === 'high' || e.sleepiness === 'dangerous'
  ).length;
  if (dangerousCount >= 1) {
    return { triggered: true, level: 'urgent', count: dangerousCount };
  }
  if (highOrDangerousCount >= 3) {
    return { triggered: true, level: 'sustained', count: highOrDangerousCount };
  }
  return { triggered: false };
}

export function checkApneaFlag(screener) {
  return !!(screener && screener.snoringApnea);
}

export function checkSelfHarmFlag(screener) {
  return !!(screener && screener.selfHarm);
}

// Aggregates every safety check into one ordered list. Order matters: more
// urgent, less CBT-I-related conditions are listed first because they stop
// CBT-I coaching entirely rather than just adjusting the window.
export function runSafetyChecks({ windowMin, diaryEntries, screener }) {
  const events = [];
  if (checkSelfHarmFlag(screener)) {
    events.push({ code: 'self_harm', severity: 'stop_and_refer' });
  }
  if (checkApneaFlag(screener)) {
    events.push({ code: 'apnea', severity: 'stop_and_refer' });
  }
  const sleepiness = checkSustainedSleepiness(diaryEntries || []);
  if (sleepiness.triggered) {
    events.push({ code: 'daytime_sleepiness', severity: sleepiness.level, count: sleepiness.count });
  }
  if (windowMin != null && checkWindowFloor(windowMin)) {
    events.push({ code: 'window_floor', severity: 'refer' });
  }
  return events;
}

// Nights with valid data inside the trailing calendar window, given
// "today" as an ISO date string and an array of {date: 'YYYY-MM-DD', ...}.
export function nightsInTrailingWindow(entries, todayIso, lookbackDays) {
  const today = new Date(todayIso + 'T00:00:00');
  return entries.filter((e) => {
    const d = new Date(e.date + 'T00:00:00');
    const diffDays = Math.round((today - d) / 86400000);
    return diffDays >= 0 && diffDays < lookbackDays;
  });
}
