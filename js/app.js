import * as E from './engine.js';
import { getState, setState, subscribe, resetAll, upsertDiaryEntry, effectiveToday, nextEntryDate } from './store.js';
import { loadData, getData, t, pick } from './i18n.js';
import { computeDiaryFlags, evaluateTopic } from './troubleshooter.js';

const appEl = document.getElementById('app');
const navEl = document.getElementById('bottomnav');
const gateEl = document.getElementById('safetygate');

function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function lang() {
  return getState().language;
}

// ---------------------------------------------------------------------
// Safety gate: a blocking modal, not a dismissible banner. Every branch
// here corresponds 1:1 to a rule in engine.js runSafetyChecks(). See
// README.md "What needs clinical review" before this is shown to anyone
// outside the team.
// ---------------------------------------------------------------------

function pendingSafetyEvents() {
  const state = getState();
  const events = E.runSafetyChecks({
    windowMin: state.windowMin,
    diaryEntries: state.diaryEntries,
    screener: state.screener,
  });
  const lastDate = state.diaryEntries.length
    ? state.diaryEntries[state.diaryEntries.length - 1].date
    : null;

  return events.filter((ev) => {
    if (ev.code === 'self_harm') return !state.ack.selfHarm;
    if (ev.code === 'apnea') return !state.ack.apnea;
    if (ev.code === 'window_floor') return !state.ack.windowFloor;
    if (ev.code === 'daytime_sleepiness') {
      const list =
        ev.severity === 'urgent' ? state.ack.sleepinessUrgentDates : state.ack.sleepinessSustainedDates;
      return !list.includes(lastDate);
    }
    return true;
  });
}

function acknowledge(ev) {
  const state = getState();
  const lastDate = state.diaryEntries.length
    ? state.diaryEntries[state.diaryEntries.length - 1].date
    : null;
  if (ev.code === 'self_harm') setState({ ack: { ...state.ack, selfHarm: true } });
  else if (ev.code === 'apnea') setState({ ack: { ...state.ack, apnea: true } });
  else if (ev.code === 'window_floor') setState({ ack: { ...state.ack, windowFloor: true } });
  else if (ev.code === 'daytime_sleepiness') {
    if (ev.severity === 'urgent') {
      setState({ ack: { ...state.ack, sleepinessUrgentDates: [...state.ack.sleepinessUrgentDates, lastDate] } });
    } else {
      setState({
        ack: { ...state.ack, sleepinessSustainedDates: [...state.ack.sleepinessSustainedDates, lastDate] },
      });
    }
  }
  renderSafetyGate();
}

const SAFETY_KEY_BY_CODE = {
  self_harm: 'selfHarm',
  apnea: 'apnea',
  window_floor: 'windowFloor',
};

function renderSafetyGate() {
  const events = pendingSafetyEvents();
  gateEl.innerHTML = '';
  if (events.length === 0) {
    gateEl.classList.add('hidden');
    return;
  }
  const ev = events[0];
  const L = lang();
  let key = SAFETY_KEY_BY_CODE[ev.code];
  if (ev.code === 'daytime_sleepiness') key = ev.severity === 'urgent' ? 'sleepinessUrgent' : 'sleepinessSustained';

  const card = h(`
    <div class="gate-card">
      <h2>${t(`safety.${key}.title`, L)}</h2>
      <p>${t(`safety.${key}.body`, L)}</p>
      <button class="btn primary" id="gate-ack">${t(`safety.${key}.button`, L)}</button>
    </div>
  `);
  card.querySelector('#gate-ack').addEventListener('click', () => acknowledge(ev));
  gateEl.appendChild(card);
  gateEl.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Window computation: recompute windowMin from diary history using the
// engine, called after every diary save.
// ---------------------------------------------------------------------

function recomputeWindow() {
  const state = getState();
  const validNights = state.diaryEntries
    .map((e) => ({ date: e.date, ...E.computeNight(e) }))
    .filter((n) => n.valid);

  const asOf = effectiveToday(state.diaryEntries);

  if (state.windowMin == null) {
    if (validNights.length >= 3) {
      const initial = E.initialWindowFromBaseline(validNights);
      setState({
        windowMin: initial,
        windowHistory: [
          ...state.windowHistory,
          { date: asOf, windowMin: initial, meanSE: null, action: 'baseline', nightsUsed: validNights.length },
        ],
      });
    }
    return;
  }

  const trailing = E.nightsInTrailingWindow(validNights, asOf, E.LOOKBACK_NIGHTS);
  const result = E.titrate(state.windowMin, trailing);
  if (result.action === 'insufficient_data') return;

  const patch = {
    windowMin: result.newWindowMin,
    windowHistory: [
      ...state.windowHistory,
      {
        date: asOf,
        windowMin: result.newWindowMin,
        meanSE: result.meanSE,
        action: result.action,
        nightsUsed: result.nightsUsed,
        clamped: result.clamped,
      },
    ],
  };
  if (result.newWindowMin > E.MIN_WINDOW_MIN) {
    patch.ack = { ...state.ack, windowFloor: false };
  }
  setState(patch);
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

const ROUTES = ['home', 'diary', 'window', 'sessions', 'ask', 'settings'];

function navigate(route) {
  const target = '#/' + route;
  if (location.hash === target) {
    // Same tab re-tapped: hashchange will not fire, so re-render explicitly.
    // This matters here more than in a typical app because saving a diary
    // night should immediately advance the form to the next night.
    render();
  } else {
    location.hash = target;
  }
}

function currentRoute() {
  const hash = location.hash.replace('#/', '');
  return ROUTES.includes(hash) ? hash : 'home';
}

function renderNav() {
  const state = getState();
  navEl.innerHTML = '';
  if (!state.onboarded) {
    navEl.classList.add('hidden');
    return;
  }
  navEl.classList.remove('hidden');
  const route = currentRoute();
  for (const r of ROUTES) {
    const btn = h(`<button class="navbtn ${r === route ? 'active' : ''}" data-route="${r}">${t(`nav.${r}`, lang())}</button>`);
    btn.addEventListener('click', () => navigate(r));
    navEl.appendChild(btn);
  }
}

function render() {
  const state = getState();
  renderSafetyGate();
  renderNav();
  if (!state.onboarded) {
    renderOnboarding();
    return;
  }
  const route = currentRoute();
  if (route === 'home') renderHome();
  else if (route === 'diary') renderDiary();
  else if (route === 'window') renderWindowScreen();
  else if (route === 'sessions') renderSessions();
  else if (route === 'ask') renderAsk();
  else if (route === 'settings') renderSettings();
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------

function renderOnboarding() {
  const L = lang();
  const state = getState();
  appEl.innerHTML = '';

  const langRow = h(`
    <div class="lang-toggle" id="lang-toggle-onboard"></div>
  `);
  for (const langOpt of getData().i18n.languages) {
    const b = h(`<button class="langbtn ${langOpt.code === L ? 'active' : ''}">${langOpt.label}</button>`);
    b.addEventListener('click', () => {
      setState({ language: langOpt.code });
      render();
    });
    langRow.appendChild(b);
  }

  const screenerDone = state.screener.snoringApnea !== null && state.screener.selfHarm !== null;

  const card = h(`
    <div class="screen">
      <h1>${t('landing.appName', L)}</h1>
      <p class="tagline">${t('landing.tagline', L)}</p>
      <h2>${t('onboarding.title', L)}</h2>
      <p>${t('onboarding.screenerIntro', L)}</p>
      <div class="field">
        <label>${t('onboarding.screenerApnea', L)}</label>
        <div class="yesno" data-q="snoringApnea">
          <button class="btn ${state.screener.snoringApnea === true ? 'selected' : ''}" data-val="true">${t('onboarding.yes', L)}</button>
          <button class="btn ${state.screener.snoringApnea === false ? 'selected' : ''}" data-val="false">${t('onboarding.no', L)}</button>
        </div>
      </div>
      <div class="field">
        <label>${t('onboarding.screenerSelfHarm', L)}</label>
        <div class="yesno" data-q="selfHarm">
          <button class="btn ${state.screener.selfHarm === true ? 'selected' : ''}" data-val="true">${t('onboarding.yes', L)}</button>
          <button class="btn ${state.screener.selfHarm === false ? 'selected' : ''}" data-val="false">${t('onboarding.no', L)}</button>
        </div>
      </div>
      <div class="field">
        <label>${t('onboarding.wakeTimeLabel', L)}</label>
        <input type="time" id="wake-time-input" value="${state.wakeTime || '06:00'}">
      </div>
      <button class="btn primary wide" id="onboard-continue" ${screenerDone ? '' : 'disabled'}>${t('onboarding.continueButton', L)}</button>
    </div>
  `);
  card.prepend(langRow);

  card.querySelectorAll('.yesno').forEach((row) => {
    row.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = row.dataset.q;
        const val = btn.dataset.val === 'true';
        setState({ screener: { ...getState().screener, [q]: val } });
        render();
      });
    });
  });

  card.querySelector('#onboard-continue').addEventListener('click', () => {
    const wakeTime = card.querySelector('#wake-time-input').value;
    setState({ onboarded: true, wakeTime });
    location.hash = '#/home';
    render();
  });

  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------

function renderHome() {
  const L = lang();
  appEl.innerHTML = '';
  const card = h(`
    <div class="screen">
      <h1>${t('landing.appName', L)}</h1>
      <p class="tagline">${t('landing.tagline', L)}</p>
      <div class="callout">
        <h2>${t('landing.whatThisIsTitle', L)}</h2>
        <p>${t('landing.whatThisIsBody', L)}</p>
      </div>
      <p class="muted">${t('landing.offlineNote', L)}</p>
      <button class="btn primary wide" id="go-diary">${t('landing.startButton', L)}</button>
    </div>
  `);
  card.querySelector('#go-diary').addEventListener('click', () => navigate('diary'));
  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Diary
// ---------------------------------------------------------------------

function renderDiary() {
  const L = lang();
  const state = getState();
  appEl.innerHTML = '';
  const nextDate = nextEntryDate(state.diaryEntries);
  const existing = {};
  const interference = {};
  const nightNumber = state.diaryEntries.length + 1;

  const card = h(`
    <div class="screen">
      <h1>${t('diary.title', L)} &middot; ${t('diary.nightLabel', L)} ${nightNumber}</h1>
      <p class="muted">${t('diary.source', L)}</p>
      <form id="diary-form">
        <div class="field"><label>${t('diary.napMin', L)}</label>
          <input type="number" min="0" name="napMin" value="${existing.napMin ?? ''}"></div>
        <div class="field"><label>${t('diary.bedTime', L)}</label>
          <input type="time" name="bedTime" value="${existing.bedTime ?? ''}"></div>
        <div class="field"><label>${t('diary.sleepTryTime', L)}</label>
          <input type="time" name="sleepTryTime" value="${existing.sleepTryTime ?? ''}"></div>
        <div class="field"><label>${t('diary.solMin', L)}</label>
          <input type="number" min="0" name="solMin" value="${existing.solMin ?? ''}"></div>
        <div class="field"><label>${t('diary.wasoMin', L)}</label>
          <input type="number" min="0" name="wasoMin" value="${existing.wasoMin ?? ''}"></div>
        <div class="field"><label>${t('diary.wakeTime', L)}</label>
          <input type="time" name="wakeTime" value="${existing.wakeTime ?? ''}"></div>
        <div class="field"><label>${t('diary.outOfBedTime', L)}</label>
          <input type="time" name="outOfBedTime" value="${existing.outOfBedTime ?? ''}"></div>

        <fieldset>
          <legend>${t('diary.interferenceTitle', L)}</legend>
          <label class="checkbox"><input type="checkbox" name="int_temperature" ${interference.temperature ? 'checked' : ''}> ${t('diary.interferenceTemperature', L)}</label>
          <label class="checkbox"><input type="checkbox" name="int_noise" ${interference.noise ? 'checked' : ''}> ${t('diary.interferenceNoise', L)}</label>
          <label class="checkbox"><input type="checkbox" name="int_light" ${interference.light ? 'checked' : ''}> ${t('diary.interferenceLight', L)}</label>
          <label class="checkbox"><input type="checkbox" name="int_worrySleep" ${interference.worrySleep ? 'checked' : ''}> ${t('diary.interferenceWorrySleep', L)}</label>
          <label class="checkbox"><input type="checkbox" name="int_worryWork" ${interference.worryWork ? 'checked' : ''}> ${t('diary.interferenceWorryWork', L)}</label>
          <label class="checkbox"><input type="checkbox" name="int_worryFamily" ${interference.worryFamily ? 'checked' : ''}> ${t('diary.interferenceWorryFamily', L)}</label>
        </fieldset>

        <fieldset>
          <legend>${t('diary.sleepinessTitle', L)}</legend>
          <label class="radio"><input type="radio" name="sleepiness" value="none" ${existing.sleepiness === 'none' ? 'checked' : ''}> ${t('diary.sleepinessNone', L)}</label>
          <label class="radio"><input type="radio" name="sleepiness" value="mild" ${existing.sleepiness === 'mild' ? 'checked' : ''}> ${t('diary.sleepinessMild', L)}</label>
          <label class="radio"><input type="radio" name="sleepiness" value="high" ${existing.sleepiness === 'high' ? 'checked' : ''}> ${t('diary.sleepinessHigh', L)}</label>
          <label class="radio"><input type="radio" name="sleepiness" value="dangerous" ${existing.sleepiness === 'dangerous' ? 'checked' : ''}> ${t('diary.sleepinessDangerous', L)}</label>
        </fieldset>

        <button type="submit" class="btn primary wide">${t('diary.saveButton', L)}</button>
      </form>
      <p id="diary-note" class="muted"></p>
    </div>
  `);

  card.querySelector('#diary-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const entry = {
      date: nextDate,
      napMin: fd.get('napMin') === '' ? null : Number(fd.get('napMin')),
      bedTime: fd.get('bedTime') || '',
      sleepTryTime: fd.get('sleepTryTime') || '',
      solMin: fd.get('solMin') === '' ? null : Number(fd.get('solMin')),
      wasoMin: fd.get('wasoMin') === '' ? null : Number(fd.get('wasoMin')),
      wakeTime: fd.get('wakeTime') || '',
      outOfBedTime: fd.get('outOfBedTime') || '',
      interference: {
        temperature: fd.get('int_temperature') === 'on',
        noise: fd.get('int_noise') === 'on',
        light: fd.get('int_light') === 'on',
        worrySleep: fd.get('int_worrySleep') === 'on',
        worryWork: fd.get('int_worryWork') === 'on',
        worryFamily: fd.get('int_worryFamily') === 'on',
      },
      sleepiness: fd.get('sleepiness') || 'none',
    };

    const note = card.querySelector('#diary-note');
    const check = E.computeNight(entry);
    if (!check.valid && check.reason === 'incomplete') {
      note.textContent = t('diary.incompleteNote', L);
      return;
    }

    upsertDiaryEntry(entry);
    recomputeWindow();
    const message = !check.valid ? t('diary.implausibleNote', L) : t('diary.savedNote', L);
    renderSafetyGate();
    renderDiary(); // advance to a fresh form for the next night
    appEl.querySelector('#diary-note').textContent = message;
  });

  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------

function renderWindowScreen() {
  const L = lang();
  const state = getState();
  appEl.innerHTML = '';

  if (state.windowMin == null) {
    const card = h(`
      <div class="screen">
        <h1>${t('window.title', L)}</h1>
        <p>${t('window.needMoreData', L)}</p>
      </div>
    `);
    appEl.appendChild(card);
    return;
  }

  const bedtime = E.prescribeBedtime(state.wakeTime, state.windowMin);
  const hours = Math.floor(state.windowMin / 60);
  const mins = state.windowMin % 60;
  const last = state.windowHistory[state.windowHistory.length - 1];

  let reasoning = '';
  if (last && last.action === 'baseline') {
    reasoning = `<p>${t('window.baselineNote', L).replace('{n}', last.nightsUsed)}</p>`;
  } else if (last) {
    const pct = Math.round(last.meanSE * 1000) / 10;
    const actionKey = last.action === 'extend' ? 'actionExtend' : last.action === 'reduce' ? 'actionReduce' : 'actionHold';
    reasoning = `
      <p>${t('window.meanSELabel', L).replace('{n}', last.nightsUsed)}: <strong>${pct}%</strong></p>
      <p>${t(`window.${actionKey}`, L)}</p>
      ${last.clamped ? `<p class="warn">${t('window.clampedNote', L)}</p>` : ''}
    `;
  }

  const card = h(`
    <div class="screen">
      <h1>${t('window.title', L)}</h1>
      <div class="window-card">
        <div class="window-row"><span>${t('window.bedtimeLabel', L)}</span><strong>${bedtime}</strong></div>
        <div class="window-row"><span>${t('window.waketimeLabel', L)}</span><strong>${state.wakeTime}</strong></div>
        <div class="window-row"><span>${t('window.windowLabel', L)}</span><strong>${hours}h ${mins}m</strong></div>
      </div>
      <div class="callout">
        <h2>${t('window.reasoningTitle', L)}</h2>
        ${reasoning || `<p class="muted">${t('window.needMoreData', L)}</p>`}
      </div>
      <p class="muted small">${t('window.sourceNote', L)}</p>
    </div>
  `);
  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

function renderSessions() {
  const L = lang();
  appEl.innerHTML = '';
  const card = h(`<div class="screen"><h1>${t('nav.sessions', L)}</h1></div>`);
  for (const s of getData().sessions.sessions) {
    const details = h(`
      <details class="session-card">
        <summary>${s.number}. ${pick(s.title, L)}</summary>
        <ul>
          ${s.points.map((p) => `<li>${pick(p, L)}</li>`).join('')}
        </ul>
        <p class="commitment">"${pick(s.commitment, L)}"</p>
      </details>
    `);
    card.appendChild(details);
  }
  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Ask (troubleshooter)
// ---------------------------------------------------------------------

function renderAsk() {
  const L = lang();
  const state = getState();
  appEl.innerHTML = '';
  const card = h(`
    <div class="screen">
      <h1>${t('ask.title', L)}</h1>
      <p class="muted">${t('ask.subtitle', L)}</p>
      <p class="section-label">${t('ask.modeALabel', L)}</p>
      <div id="topic-list"></div>
      <div id="topic-response"></div>
    </div>
  `);
  const list = card.querySelector('#topic-list');
  const responseEl = card.querySelector('#topic-response');
  const flags = computeDiaryFlags(state.diaryEntries, E.computeNight);

  for (const topic of getData().troubleshooter.topics) {
    const btn = h(`<button class="btn topic-btn">${pick(topic.prompt, L)}</button>`);
    btn.addEventListener('click', () => {
      if (topic.routesToSafety === 'apnea') {
        setState({ screener: { ...state.screener, snoringApnea: true }, ack: { ...state.ack, apnea: false } });
        renderSafetyGate();
        return;
      }
      if (topic.routesToSafety === 'selfHarm') {
        setState({ screener: { ...state.screener, selfHarm: true }, ack: { ...state.ack, selfHarm: false } });
        renderSafetyGate();
        return;
      }
      const response = evaluateTopic(topic, flags);
      responseEl.innerHTML = `<div class="response-card">${pick(response, L)}</div>`;
    });
    list.appendChild(btn);
  }

  const byokSection = h(`
    <div class="callout">
      <p class="section-label">${t('ask.modeBLabel', L)}</p>
      ${
        state.byokKey
          ? `<textarea id="freeform-q" placeholder="..." rows="2"></textarea>
             <button class="btn" id="freeform-send">Send</button>
             <div id="freeform-answer" class="response-card"></div>`
          : `<p class="muted small">${t('settings.byokBody', L)}</p>`
      }
    </div>
  `);
  card.appendChild(byokSection);

  if (state.byokKey) {
    byokSection.querySelector('#freeform-send').addEventListener('click', async () => {
      const q = byokSection.querySelector('#freeform-q').value.trim();
      const answerEl = byokSection.querySelector('#freeform-answer');
      if (!q) return;
      answerEl.textContent = '...';
      try {
        const answer = await askGenerativeLayer(q, state.byokKey, L);
        answerEl.textContent = answer;
      } catch (err) {
        answerEl.textContent = 'Could not reach the model (check your key and your connection). Error: ' + err.message;
      }
    });
  }

  appEl.appendChild(card);
}

// Mode B: bring-your-own-key generative layer. Optional demo affordance,
// only reachable if a reviewer pastes their own key in Settings. The key
// is read from localStorage and sent directly from this browser to the
// model provider; this app's own code and hosting never see it. Untested
// against a live key during this build (no key was available); verify
// before relying on it. See README.md.
async function askGenerativeLayer(question, apiKey, language) {
  const languageNote = { en: 'English', sw: 'Kiswahili', sheng: 'Sheng (Nairobi urban register)' }[language];
  const system = `You are a narrow assistant inside a CBT-I (cognitive behavioral therapy for insomnia) demo app for a Kenyan research study. Answer only questions about sleep and this program, in ${languageNote}, in 2 to 4 short sentences, in plain language for a phone screen. Never diagnose. If the question raises self-harm or a possible breathing/apnea problem, do not answer it: instead say this needs the safety screen in the app, and stop.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: question }],
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  return block ? block.text : '(no answer)';
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

function renderSettings() {
  const L = lang();
  const state = getState();
  appEl.innerHTML = '';
  const card = h(`
    <div class="screen">
      <h1>${t('settings.title', L)}</h1>
      <div class="field">
        <label>${t('settings.languageLabel', L)}</label>
        <div class="lang-toggle" id="lang-toggle-settings"></div>
      </div>

      <div class="callout">
        <h2>${t('settings.byokTitle', L)}</h2>
        <p>${t('settings.byokBody', L)}</p>
        <input type="password" id="byok-input" placeholder="${t('settings.byokKeyLabel', L)}" value="${state.byokKey || ''}">
        <button class="btn" id="byok-save">${t('settings.byokSave', L)}</button>
        <button class="btn" id="byok-clear">${t('settings.byokClear', L)}</button>
      </div>

      <div class="callout">
        <h2>${t('settings.resetTitle', L)}</h2>
        <p>${t('settings.resetBody', L)}</p>
        <button class="btn danger" id="reset-btn">${t('settings.resetButton', L)}</button>
      </div>
    </div>
  `);

  const langRow = card.querySelector('#lang-toggle-settings');
  for (const langOpt of getData().i18n.languages) {
    const b = h(`<button class="langbtn ${langOpt.code === L ? 'active' : ''}">${langOpt.label}</button>`);
    b.addEventListener('click', () => {
      setState({ language: langOpt.code });
      render();
    });
    langRow.appendChild(b);
  }

  card.querySelector('#byok-save').addEventListener('click', () => {
    const val = card.querySelector('#byok-input').value.trim();
    setState({ byokKey: val || null });
    render();
  });
  card.querySelector('#byok-clear').addEventListener('click', () => {
    setState({ byokKey: null });
    render();
  });
  card.querySelector('#reset-btn').addEventListener('click', () => {
    if (confirm(t('settings.resetConfirm', L))) {
      resetAll();
      location.hash = '#/home';
      render();
    }
  });

  appEl.appendChild(card);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function boot() {
  await loadData();
  subscribe(() => {}); // state changes are re-rendered explicitly by callers
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
