// Audit state management — реальные проверки (async API)
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('OK  ', name); passed++; }
  catch (e) { console.log('FAIL', name, '\n     ', e.message); failed++; }
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { if (typeof v !== 'string') throw new TypeError('must be string'); store.set(k, v); },
  removeItem: (k) => store.delete(k)
};
// IndexedDB замокан — недоступен, тесты проверяют fallback на localStorage.
globalThis.indexedDB = undefined;

const { loadState, saveState, clearState, emptyState } = await import('../src/store.js');

const isEmptyState = (s) => s && typeof s === 'object' && Object.keys(s.sheets).length === 0 && s.current === '';

await test('emptyState: возвращает пустое', async () => {
  if (!isEmptyState(emptyState())) throw new Error('not empty');
});

await test('saveState: round-trip', async () => {
  const r = await saveState({ sheets: { ПСТ: [{ day: 'Пн', time: '08:00', group: 'ПСТ-1-25' }] }, current: 'ПСТ', group: '' });
  if (r !== 'ls') throw new Error('save must return "ls"');
  const s = await loadState();
  if (s.sheets.ПСТ.length !== 1) throw new Error('round-trip failed');
  if (s.current !== 'ПСТ') throw new Error('current not preserved');
});

await test('loadState: corrupted JSON → empty', async () => {
  store.set('schedule:v1', '{not valid json');
  if (!isEmptyState(await loadState())) throw new Error('corrupted state must return empty');
});

await test('loadState: missing key → empty', async () => {
  store.clear();
  if (!isEmptyState(await loadState())) throw new Error('missing key must return empty');
});

await test('loadState: schema migration — старый формат без current', async () => {
  store.set('schedule:v1', JSON.stringify({ sheets: { X: [] } }));
  const s = await loadState();
  if (s.current !== 'X') throw new Error('должен выбрать первый sheet');
});

await test('loadState: malformed (sheet not object) → empty', async () => {
  store.set('schedule:v1', JSON.stringify({ sheets: 'not-object' }));
  if (!isEmptyState(await loadState())) throw new Error('invalid schema → empty');
});

await test('clearState: works', async () => {
  await saveState({ sheets: { A: [] }, current: 'A', group: '' });
  await clearState();
  if (!isEmptyState(await loadState())) throw new Error('clearState failed');
});

await test('saveState: quota exceeded → "none" (no idb)', async () => {
  const realLS = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { const e = new Error('Quota exceeded'); e.name = 'QuotaExceededError'; throw e; },
    removeItem: () => {}
  };
  const r = await saveState({ sheets: { A: [] }, current: 'A', group: '' });
  if (r !== 'none') throw new Error('saveState должен вернуть "none" когда и ls и idb недоступны');
  globalThis.localStorage = realLS;
});

await test('saveState: localStorage в private mode (setItem throws) → "none"', async () => {
  const realLS = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => {}
  };
  let s;
  try { s = await loadState(); } catch (e) { throw new Error('loadState не должен падать в private mode'); }
  if (!s) throw new Error('loadState должен вернуть значение');
  let r;
  try { r = await saveState({ sheets: {}, current: '', group: '' }); } catch (e) { throw new Error('saveState не должен падать в private mode'); }
  if (r !== 'none') throw new Error('saveState должен вернуть "none" в private mode');
  globalThis.localStorage = realLS;
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
