// Deterministic branch evaluation for the scripted troubleshooter
// (data/troubleshooter.json). No free-text parsing happens here: the user
// taps a fixed prompt, and the response is chosen entirely from computed
// diary-state flags. This keeps Mode A offline-safe and hallucination-free.

function lastValidNight(diaryEntries, computeNight) {
  for (let i = diaryEntries.length - 1; i >= 0; i--) {
    const night = computeNight(diaryEntries[i]);
    if (night.valid) return { entry: diaryEntries[i], night };
  }
  return null;
}

export function computeDiaryFlags(diaryEntries, computeNight) {
  const last = lastValidNight(diaryEntries, computeNight);
  if (!last) return {};
  const { entry } = last;
  const interference = entry.interference || {};
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
  };
}

// Returns the {en,sw,sheng} response object for a topic, given computed flags.
export function evaluateTopic(topic, flags) {
  for (const branch of topic.branches) {
    const match = branch.when.every((cond) => flags[cond.flag] === cond.equals);
    if (match) return branch.response;
  }
  return topic.fallback;
}
