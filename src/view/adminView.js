/**
 * UI админки PenDrops.
 * Модалка: PIN → drop zone → статус → кнопка Опубликовать.
 */
import { publishSchedule, isAdminConfigured } from '../admin.js';

export function createAdminView() {
  let open = false;
  let pickedFile = null;

  const build = () => {
    const root = document.createElement('div');
    root.id = 'adminModal';
    root.className = 'modal hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="modal-backdrop" data-close="admin"></div>
      <div class="modal-content admin-content">
        <div class="modal-header">
          <h2>👑 Админка</h2>
          <button class="modal-close" data-close="admin" aria-label="Закрыть">✕</button>
        </div>
        <div class="admin-body">
          <p class="admin-hint">Введите PIN и перетащите Excel-файл расписания</p>

          <div class="admin-step" id="stepPin">
            <label>PIN</label>
            <input type="password" inputmode="numeric" maxlength="6" pattern="[0-9]*"
                   id="adminPin" placeholder="••••" autocomplete="off" />
            <button class="btn primary block" id="adminPinBtn">Войти</button>
            <div class="admin-error" id="adminError"></div>
          </div>

          <div class="admin-step hidden" id="stepDrop">
            <div class="drop-zone" id="adminDrop">
              <div class="drop-zone-text">
                <div class="drop-zone-icon">📂</div>
                <div>Перетащите .xls / .xlsx сюда</div>
                <div class="drop-zone-sub">или нажмите чтобы выбрать</div>
              </div>
              <input type="file" id="adminFile" accept=".xls,.xlsx,.csv" hidden />
            </div>
            <div class="admin-picked hidden" id="adminPicked">
              <div>📄 <span id="adminFileName">—</span></div>
              <button class="btn ghost small" id="adminReset">Сбросить</button>
            </div>
            <button class="btn primary block hidden" id="adminPublish">🚀 Опубликовать</button>
            <div class="admin-status" id="adminStatus"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  };

  const root = build();
  const pin = /** @type {HTMLInputElement} */ (root.querySelector('#adminPin'));
  const pinBtn = root.querySelector('#adminPinBtn');
  const errEl = root.querySelector('#adminError');
  const stepPin = root.querySelector('#stepPin');
  const stepDrop = root.querySelector('#stepDrop');
  const drop = root.querySelector('#adminDrop');
  const file = /** @type {HTMLInputElement} */ (root.querySelector('#adminFile'));
  const picked = root.querySelector('#adminPicked');
  const fileName = root.querySelector('#adminFileName');
  const reset = root.querySelector('#adminReset');
  const publish = root.querySelector('#adminPublish');
  const status = root.querySelector('#adminStatus');

  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 4000);
  };

  pinBtn.addEventListener('click', () => {
    const v = pin.value.trim();
    if (!v) { showError('Введите PIN'); return; }
    if (v !== '6137') { showError('Неверный PIN'); pin.value = ''; return; }
    stepPin.classList.add('hidden');
    stepDrop.classList.remove('hidden');
    status.textContent = '⏳ Проверяю настройки...';
    isAdminConfigured().then(ok => {
      status.textContent = ok
        ? '✅ Токен найден, готов к публикации'
        : '⚠️ admin.json не найден в репо. См. README.';
    });
  });
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinBtn.click(); });

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => { if (file.files?.[0]) setFile(file.files[0]); });

  function setFile(f) {
    pickedFile = f;
    fileName.textContent = f.name;
    picked.classList.remove('hidden');
    publish.classList.remove('hidden');
    status.textContent = '';
  }
  reset.addEventListener('click', () => {
    pickedFile = null;
    picked.classList.add('hidden');
    publish.classList.add('hidden');
    file.value = '';
  });

  publish.addEventListener('click', async () => {
    if (!pickedFile) return;
    publish.disabled = true;
    status.innerHTML = '⏳ Загружаю в GitHub...';
    try {
      const r = await publishSchedule(pickedFile);
      status.innerHTML = `✅ Опубликовано! <b>${r.version}</b> · ${r.datestamp}<br><span class="admin-sub">Ученики получат через 1-2 мин</span>`;
      publish.classList.add('hidden');
      picked.classList.add('hidden');
    } catch (err) {
      status.innerHTML = '❌ ' + (err.message || String(err));
    } finally {
      publish.disabled = false;
    }
  });

  root.querySelectorAll('[data-close="admin"]').forEach(el =>
    el.addEventListener('click', close)
  );

  function show() {
    root.classList.remove('hidden');
    open = true;
    setTimeout(() => pin.focus(), 100);
  }
  function close() {
    root.classList.add('hidden');
    open = false;
    pin.value = '';
    pickedFile = null;
    file.value = '';
    picked.classList.add('hidden');
    publish.classList.add('hidden');
    publish.disabled = false;
    stepDrop.classList.add('hidden');
    stepPin.classList.remove('hidden');
    status.textContent = '';
    errEl.classList.add('hidden');
  }
  function isOpen() { return open; }

  return { show, close, isOpen };
}
