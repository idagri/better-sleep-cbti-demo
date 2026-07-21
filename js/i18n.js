// Loads the three JSON content files once and exposes a tiny t() lookup.
// All strings are structured data (see data/*.json), never buried in code.
let dataCache = null;

export async function loadData() {
  if (dataCache) return dataCache;
  const [i18n, sessions, troubleshooter, examples] = await Promise.all([
    fetch('data/i18n.json').then((r) => r.json()),
    fetch('data/sessions.json').then((r) => r.json()),
    fetch('data/troubleshooter.json').then((r) => r.json()),
    fetch('data/examples.json').then((r) => r.json()),
  ]);
  dataCache = { i18n, sessions, troubleshooter, examples };
  return dataCache;
}

export function getData() {
  return dataCache;
}

// path like "nav.home" resolved against data/i18n.json, in the given language.
export function t(path, lang) {
  const parts = path.split('.');
  let node = dataCache && dataCache.i18n;
  for (const p of parts) {
    if (node == null) return path;
    node = node[p];
  }
  if (node == null || typeof node !== 'object') return path;
  return node[lang] || node.en || path;
}

// A {en,sw,sheng} object (e.g. a session point or troubleshooter response)
// resolved directly, without a path lookup.
export function pick(obj, lang) {
  if (!obj) return '';
  return obj[lang] || obj.en || '';
}
