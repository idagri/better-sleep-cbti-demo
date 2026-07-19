// Everything the app remembers lives in localStorage under one key. No
// network calls, no analytics, nothing leaves this device. See README.md.
const STORAGE_KEY = 'cbti_demo_v1';

function defaultState() {
  return {
    language: 'en',
    onboarded: false,
    wakeTime: null, // "HH:MM", the fixed anchor the user commits to
    screener: { snoringApnea: null },
    diaryEntries: [], // { date, napMin, bedTime, sleepTryTime, solMin, wasoMin, wakeTime, outOfBedTime, interference:{}, sleepiness }
    windowMin: null, // current prescribed window, once established
    windowHistory: [], // { date, windowMin, meanSE, action, nightsUsed }
    byokKey: null,
    ack: {
      apnea: false,
      windowFloor: false,
      sleepinessUrgentDates: [],
      sleepinessSustainedDates: [],
    },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch (e) {
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetAll() {
  state = defaultState();
  persist();
  listeners.forEach((fn) => fn(state));
}

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The reference date the engine treats as "now" for the rolling 7-night
// window: the most recent diary entry's date, not the device clock. This
// lets several nights be logged in one sitting (as a reviewer testing this
// demo would) and also tolerates a real participant's diary lagging a day
// or two behind, without either case breaking the trailing-window math.
export function effectiveToday(diaryEntries) {
  if (!diaryEntries.length) return todayIso();
  return diaryEntries[diaryEntries.length - 1].date;
}

// The date the NEXT diary entry should use: the day after the last logged
// night, or today if this is the first entry ever.
export function nextEntryDate(diaryEntries) {
  if (!diaryEntries.length) return todayIso();
  return addDaysIso(diaryEntries[diaryEntries.length - 1].date, 1);
}

// Upserts a diary entry by date (one entry per calendar day; re-saving the
// same date overwrites it rather than duplicating).
export function upsertDiaryEntry(entry) {
  const others = state.diaryEntries.filter((e) => e.date !== entry.date);
  const diaryEntries = [...others, entry].sort((a, b) => (a.date < b.date ? -1 : 1));
  setState({ diaryEntries });
}
