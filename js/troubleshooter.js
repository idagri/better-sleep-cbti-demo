// Deterministic branch evaluation for the scripted troubleshooter
// (data/troubleshooter.json). No free-text parsing happens here: the user
// taps a fixed prompt, and the response is chosen entirely from computed
// diary-state flags. This keeps Mode A offline-safe and hallucination-free.
import { timeStrToMinutes } from './engine.js';

function lastValidNight(diaryEntries, computeNight) {
  for (let i = diaryEntries.length - 1; i >= 0; i--) {
    const night = computeNight(diaryEntries[i]);
    if (night.valid) return { entry: diaryEntries[i], night };
  }
  return null;
}

// How many minutes before the committed wake-time anchor the person woke,
// wrapped to [0, 1439). Used for the "woke up too early" topic: comparing
// the night's own wake time against the anchor is the only way to tell
// "early" from "on time" without a second, separate diary question.
function minutesEarlyThanAnchor(nightWakeTimeStr, wakeTimeAnchorStr) {
  const nightMin = timeStrToMinutes(nightWakeTimeStr);
  const anchorMin = timeStrToMinutes(wakeTimeAnchorStr);
  if (nightMin == null || anchorMin == null) return null;
  return ((anchorMin - nightMin) % 1440 + 1440) % 1440;
}

export function computeDiaryFlags(diaryEntries, computeNight, wakeTimeAnchor) {
  const last = lastValidNight(diaryEntries, computeNight);
  if (!last) return {};
  const { entry } = last;
  const interference = entry.interference || {};
  const early = wakeTimeAnchor ? minutesEarlyThanAnchor(entry.wakeTime, wakeTimeAnchor) : null;
  return {
    elevatedSOL: Number(entry.solMin) >= 30,
    highWASO: Number(entry.wasoMin) >= 30,
    nappedYesterday: Number(entry.napMin || 0) > 0,
    flagTemperature: !!interference.temperature,
    flagNoise: !!interference.noise,
    flagLight: !!interference.light,
    flagWorrySleep: !!interference.worrySleep,
    flagWorryWork: !!interference.worryWork,
    flagWorryFamily: !!interference.worryFamily,
    anyWorryFlag: !!(interference.worrySleep || interference.worryWork || interference.worryFamily),
    anyEnvironmentFlag: !!(interference.temperature || interference.noise || interference.light),
    sleepinessHighOrDangerous: entry.sleepiness === 'high' || entry.sleepiness === 'dangerous',
    // Woke at least 30 minutes, and at most 3 hours, before the anchor.
    wokeEarlyVsAnchor: early != null && early >= 30 && early <= 180,
  };
}

// Returns { response, matched, branchId }: `matched` tells the caller
// whether this was genuinely personalized from the diary (a branch fired)
// or fell through to the generic fallback, so the UI can show that
// distinction rather than leaving it implicit in the prose.
export function evaluateTopic(topic, flags) {
  for (const branch of topic.branches) {
    const match = branch.when.every((cond) => flags[cond.flag] === cond.equals);
    if (match) return { response: branch.response, matched: true, branchId: branch.id };
  }
  return { response: topic.fallback, matched: false, branchId: null };
}
