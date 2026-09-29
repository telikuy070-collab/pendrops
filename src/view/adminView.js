/**
 * UI админки PenDrops — новая архитектура (Supabase).
 * Модалка: PIN → drop zone → предпросмотр разбора → сравнение с текущим
 * расписанием → прогресс публикации с отменой → откат по локальным снимкам.
 *
 * Файл разбирается ровно один раз: предпросмотр показывает то, что
 * `AdminService` затем и публикует. Покрытие и предупреждения ничего не
 * блокируют — они подсвечивают решение администратора, а не отменяют его.
 * @typedef {import('@core/application/services').AuthService} AuthService
 * @typedef {import('@core/application/services').AdminService} AdminService
 * @typedef {import('../admin/snapshots').SnapshotStore} SnapshotStore
 * @typedef {{show: function(string, string): void}} Toast
 */

import { buildPreviewView, formatCount } from '../admin/preview.ts';
import { formatSnapshotDate, snapshotFromSchedule } from '../admin/snapshots.ts';

const PUBLISH_LABEL = '🚀 Опубликовать';

/**
 * @param {AuthService} authService
 * @param {AdminService} adminService
 * @param {Toast} [toast]
 * @param {function(): void} [onPublished] Called after a successful publish so
 *   the host can refresh its own schedule view immediately.
 * @param {{getCurrentSchedule?: function(): any, snapshots?: SnapshotStore|null}} [options]
 *   `getCurrentSchedule` hands over the schedule the app already shows, so the
 *   comparison costs no extra request; `snapshots` is the on-device rollback
 *   point.
 * @returns {{show: function(): void, close: function(): void, isOpen: function(): boolean,
 *   stageFile: function(File): void}}
 */
export function createAdminView(authService, adminService, toast, onPublished, options = {}) {
  const getCurrentSchedule = options.getCurrentSchedule || (() => null);
  const snapshots = options.snapshots || null;

  let open = false;
  /** The file that will be published right now. */
  let pickedFile = null;
  /** A file handed over by the OS share target. Outlives close(). */
  let stagedFile = null;
  /** The parse behind the preview, kept so publishing never parses twice. */
  let preview = null;
  /** The file `preview` describes; identity decides whether a re-parse is due. */
  let previewFile = null;
  /** Guards against a slow parse of an old file overwriting a newer one. */
  let previewToken = 0;
  /** True while a publish or a rollback is in flight. */
  let busy = false;
  /** Set by the cancel button, observed between chunk requests. */
  let abortRequested = false;

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
            <div class="admin-preview hidden" id="adminPreview"></div>
            <button class="btn primary block hidden" id="adminPublish">${PUBLISH_LABEL}</button>
            <div class="admin-running hidden" id="adminRunning">
              <div class="admin-progress-label" id="adminProgressLabel">Загружено 0 из 0</div>
              <div class="admin-progress-track">
                <div class="admin-progress-fill" id="adminProgressFill"></div>
              </div>
              <button class="btn ghost small" id="adminCancel">Отменить публикацию</button>
              <div class="admin-sub" id="adminCancelNote"></div>
            </div>
            <div class="admin-status" id="adminStatus"></div>
            <div class="admin-snapshots hidden" id="adminSnapshots">
              <div class="admin-snapshots-head">🕘 Откат расписания</div>
              <div id="adminSnapshotList"></div>
              <div class="admin-sub" id="adminSnapshotNote"></div>
            </div>
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
  const previewBox = root.querySelector('#adminPreview');
  const running = root.querySelector('#adminRunning');
  const progressLabel = root.querySelector('#adminProgressLabel');
  const progressFill = root.querySelector('#adminProgressFill');
  const cancel = root.querySelector('#adminCancel');
  const cancelNote = root.querySelector('#adminCancelNote');
  const snapshotBox = root.querySelector('#adminSnapshots');
  const snapshotList = root.querySelector('#adminSnapshotList');
  const snapshotNote = root.querySelector('#adminSnapshotNote');

  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 4000);
  };

  /** A detached element with text set as text, never as markup. */
  const makeEl = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  /**
   * Status line, always as text nodes.
   *
   * Everything that reaches this line came out of a workbook or out of an
   * error message, so it is never interpolated into markup.
   */
  const setStatus = (text, sub) => {
    clear(status);
    if (text) status.append(makeEl('div', null, text));
    if (sub) status.append(makeEl('div', 'admin-sub', sub));
  };

  /** Adds a line under whatever the status already says. */
  const appendStatusNote = (text) => {
    if (!status.firstChild) return;
    status.append(makeEl('div', 'admin-sub admin-sub-warn', text));
  };

  pinBtn.addEventListener('click', async () => {
    const v = pin.value.trim();
    if (!v) {
      showError('Введите PIN');
      return;
    }
    try {
      const ok = await authService.verifyPin(v);
      if (!ok) {
        showError('Неверный PIN');
        pin.value = '';
        return;
      }
    } catch (e) {
      showError('Ошибка проверки PIN');
      return;
    }
    stepPin.classList.add('hidden');
    stepDrop.classList.remove('hidden');
    setStatus('✅ PIN верен, загрузите файл');
    void loadSnapshots();
  });
  pin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinBtn.click();
  });

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => {
    if (file.files?.[0]) setFile(file.files[0]);
  });

  function setFile(f) {
    pickedFile = f;
    // An explicit choice supersedes the file that was shared into the app.
    stagedFile = f;
    fileName.textContent = f.name;
    picked.classList.remove('hidden');
    publish.classList.remove('hidden');
    publish.disabled = false;
    publish.textContent = PUBLISH_LABEL;
    setStatus('');
    void ensurePreview(f);
  }

  reset.addEventListener('click', () => {
    pickedFile = null;
    stagedFile = null;
    preview = null;
    previewFile = null;
    previewToken++;
    adminService.clearPreview?.();
    picked.classList.add('hidden');
    publish.classList.add('hidden');
    publish.disabled = false;
    publish.textContent = PUBLISH_LABEL;
    previewBox.classList.add('hidden');
    setStatus('');
    file.value = '';
  });

  /**
   * Parses `f` unless the very same file was parsed before.
   *
   * The parse is the expensive part of an admin session — a weekly workbook is
   * several megabytes — and the result is kept, because publishing reuses it.
   * A token guards the one race that matters: the admin picks another file
   * while the first is still being read.
   */
  async function ensurePreview(f) {
    if (preview && previewFile === f) {
      renderPreview();
      return;
    }
    const token = ++previewToken;
    preview = null;
    previewFile = null;
    adminService.clearPreview?.();
    previewBox.classList.add('hidden');
    publish.disabled = true;
    setStatus('⏳ Разбираю файл…');

    try {
      const parsed = await adminService.previewFromExcel(f);
      if (token !== previewToken) return;
      preview = parsed;
      previewFile = f;
      renderPreview();
      publish.disabled = false;
      setStatus('');
    } catch (err) {
      if (token !== previewToken) return;
      console.error('[Admin] Preview failed:', err);
      const message = 'Не удалось разобрать файл: ' + (err?.message || String(err));
      // No preview means nothing to publish: the file would have to be parsed
      // again anyway, and a half-read workbook is not a publishable draft.
      publish.disabled = true;
      setStatus('❌ ' + message);
      toast?.show?.(message, 'bad');
    }
  }

  /** Renders the parse report and the comparison against what is published. */
  function renderPreview() {
    if (!preview) return;
    const view = buildPreviewView(preview, getCurrentSchedule());

    clear(previewBox);
    previewBox.append(
      makeEl(
        'div',
        'admin-preview-head',
        `Будет опубликовано: ${formatCount(view.totalLessons)} занятий`
      )
    );
    previewBox.append(
      makeEl('div', 'admin-preview-line', `Покрытие разбора: ${view.coverageText}`)
    );
    previewBox.append(makeEl('div', 'admin-preview-line', `Дни недели: ${view.daysText}`));

    if (view.sheets.length) {
      previewBox.append(
        buildTable(
          ['Лист', 'Занятий', 'Покрытие', 'Дни'],
          view.sheets.map((sheet) => {
            const cells = [
              sheet.sheetId,
              formatCount(sheet.lessonCount),
              sheet.coverageText,
              sheet.daysText,
            ];
            const extra = sheet.lostDays.length
              ? ['', makeEl('div', 'admin-cell-lost', `было: ${sheet.lostDays.join(', ')}`)]
              : null;
            return { cells, extra };
          })
        )
      );
    }

    previewBox.append(makeEl('div', 'admin-preview-counters', view.countersText));

    for (const warning of view.warnings) {
      previewBox.append(
        makeEl('div', `admin-warning admin-warning-${warning.severity}`, warning.text)
      );
    }
    if (view.rejectedSamples.length) {
      previewBox.append(makeEl('div', 'admin-preview-counters', 'Примеры отклонённых ячеек:'));
      for (const sample of view.rejectedSamples) {
        previewBox.append(makeEl('div', 'admin-warning admin-warning-warn', sample));
      }
    }

    previewBox.append(buildDiff(view.diff));
    previewBox.classList.remove('hidden');
  }

  /** `Сейчас 1854 → станет 778`, per sheet, plus a few examples either way. */
  function buildDiff(diff) {
    const box = makeEl('div', 'admin-diff');
    const head = makeEl(
      'div',
      'admin-diff-head',
      `Сейчас ${formatCount(diff.currentTotal)} → станет ${formatCount(diff.nextTotal)}`
    );
    box.append(head);

    if (diff.identical) {
      box.append(
        makeEl(
          'div',
          'admin-preview-line',
          'Расписание не изменится — публиковать можно, но смысла нет.'
        )
      );
      return box;
    }

    if (diff.sheets.length) {
      box.append(
        buildTable(
          ['Лист', 'Сейчас', 'Станет', 'Δ'],
          diff.sheets.map((sheet) => ({
            cells: [
              sheet.sheetId,
              formatCount(sheet.current),
              formatCount(sheet.next),
              (sheet.delta > 0 ? '+' : '') + formatCount(sheet.delta),
            ],
          }))
        )
      );
    }

    if (diff.disappearedCount) {
      box.append(
        makeEl('div', 'admin-preview-counters', `Пропадут: ${formatCount(diff.disappearedCount)}`)
      );
      for (const sample of diff.disappearing) {
        box.append(makeEl('div', 'admin-sample admin-sample-out', sample.text));
      }
    }
    if (diff.appearedCount) {
      box.append(
        makeEl('div', 'admin-preview-counters', `Появятся: ${formatCount(diff.appearedCount)}`)
      );
      for (const sample of diff.appearing) {
        box.append(makeEl('div', 'admin-sample admin-sample-in', sample.text));
      }
    }
    return box;
  }

  /**
   * A small table. Every row is `{ cells, extra }`; `extra` holds optional
   * nodes appended under a cell of the same index.
   */
  function buildTable(headers, rows) {
    const table = makeEl('table', 'admin-table');
    const head = makeEl('tr');
    for (const label of headers) head.append(makeEl('th', null, label));
    const thead = makeEl('thead');
    thead.append(head);
    table.append(thead);

    const tbody = makeEl('tbody');
    for (const row of rows) {
      const tr = makeEl('tr');
      row.cells.forEach((cell, index) => {
        const td = makeEl('td', null, cell);
        if (row.extra?.[index]) td.append(row.extra[index]);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(tbody);
    return table;
  }

  // ------------------------------------------------------------------
  // Progress and cancel
  // ------------------------------------------------------------------

  function showRunning(label) {
    running.classList.remove('hidden');
    progressLabel.textContent = label;
    progressFill.style.width = '0%';
    cancel.disabled = false;
    cancel.textContent = 'Отменить публикацию';
    cancelNote.textContent = '';
  }

  function renderProgress(progress) {
    const request = progress.chunks > 1 ? ` · запрос ${progress.chunk} из ${progress.chunks}` : '';
    progressLabel.textContent =
      `Загружено ${formatCount(progress.uploaded)} из ${formatCount(progress.total)}` + request;
    const ratio = progress.total > 0 ? progress.uploaded / progress.total : 0;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;
  }

  function hideRunning() {
    running.classList.add('hidden');
    cancel.disabled = false;
    cancelNote.textContent = '';
  }

  publish.addEventListener('click', async () => {
    if (!pickedFile || !preview || busy) return;
    const sourceFile = pickedFile;
    busy = true;
    abortRequested = false;

    // The rollback point is taken before the first byte is written, so a bad
    // publish can always be walked back from this device.
    const snapshotWarning = await storeSnapshot(sourceFile.name);

    publish.disabled = true;
    publish.textContent = '⏳ Публикую…';
    showRunning('Подготовка…');

    try {
      const result = await adminService.publishPreview(sourceFile, {
        onProgress: renderProgress,
        shouldAbort: () => abortRequested,
      });
      const count = result && typeof result.count === 'number' ? result.count : 0;
      toast?.show?.(`Опубликовано: ${count} занятий`, 'ok');
      setStatus(
        `✅ Опубликовано: ${count} занятий`,
        'Ученики увидят новое расписание в течение секунды'
      );
      publish.classList.add('hidden');
      picked.classList.add('hidden');
      hideRunning();
      void loadSnapshots();
      // The admin's own screen is stale right now — reload it from the source.
      try {
        onPublished?.();
      } catch (err) {
        console.warn('[Admin] post-publish refresh failed:', err);
      }
    } catch (err) {
      hideRunning();
      publish.disabled = false;
      publish.textContent = PUBLISH_LABEL;
      if (err?.code === 'PUBLISH_ABORTED') {
        // Honest about the leftovers: the rows that already landed are still
        // in the table, and only a full re-publish removes them.
        setStatus(
          '⚠️ ' + err.message,
          `Кнопка «${PUBLISH_LABEL}» снова доступна — полная публикация заново заменит расписание и уберёт загруженный кусок.`
        );
        toast?.show?.('Публикация остановлена', 'bad');
      } else {
        console.error('[Admin] Publish failed:', err);
        const message = 'Ошибка публикации: ' + (err?.message || String(err));
        setStatus(message);
        toast?.show?.(message, 'bad');
      }
    } finally {
      busy = false;
      if (snapshotWarning) {
        // A missing rollback point is worth saying out loud, but it is not a
        // reason to stop a publish the admin has already confirmed.
        console.warn('[Admin] snapshot not saved:', snapshotWarning);
        appendStatusNote('Снимок для отката сохранить не удалось: ' + snapshotWarning);
      }
    }
  });

  cancel.addEventListener('click', () => {
    if (!busy || abortRequested) return;
    const proceed = window.confirm(
      'Прервать публикацию?\n\n' +
        'Уже загруженная часть останется в базе, и ученики увидят её вместе со старым расписанием — дубликаты.\n' +
        'Опубликуйте файл заново целиком, чтобы база вернулась в порядок.'
    );
    if (!proceed) return;
    abortRequested = true;
    cancel.disabled = true;
    cancelNote.textContent = 'Останавливаю после текущего запроса…';
  });

  // ------------------------------------------------------------------
  // Snapshots and rollback
  // ------------------------------------------------------------------

  const SNAPSHOT_NOTE =
    'Снимки хранятся только на этом устройстве, в локальном хранилище браузера, где было опубликовано расписание. С другого телефона или после очистки данных отката не будет.';

  /**
   * Saves the schedule that is on screen right now.
   *
   * Returns a reason string when nothing could be saved, so the caller can say
   * so; it never throws, because a missing rollback point must not stop a
   * publish the admin has already confirmed.
   */
  async function storeSnapshot(fileName) {
    if (!snapshots) return 'хранилище снимков недоступно';
    const snapshot = snapshotFromSchedule(getCurrentSchedule(), fileName);
    if (!snapshot) return 'текущее расписание не загружено';
    try {
      await snapshots.save(snapshot);
      return null;
    } catch (err) {
      console.warn('[Admin] Failed to save snapshot:', err);
      return err?.message || String(err);
    }
  }

  /** Lists the rollback points, newest first, and says so when there are none. */
  async function loadSnapshots() {
    snapshotBox.classList.remove('hidden');
    snapshotNote.textContent = SNAPSHOT_NOTE;
    clear(snapshotList);

    if (!snapshots) {
      snapshotList.append(makeEl('div', 'admin-sub', 'Снимки недоступны в этом браузере.'));
      return;
    }
    let metas = [];
    try {
      metas = await snapshots.list();
    } catch (err) {
      console.warn('[Admin] Failed to read snapshots:', err);
      snapshotList.append(
        makeEl(
          'div',
          'admin-sub',
          'Не удалось прочитать снимки: браузер запретил локальное хранилище.'
        )
      );
      return;
    }

    if (!metas.length) {
      snapshotList.append(
        makeEl('div', 'admin-sub', 'Снимков пока нет. Они появляются перед каждой публикацией.')
      );
      return;
    }
    for (const meta of metas) snapshotList.append(buildSnapshotRow(meta));
  }

  function buildSnapshotRow(meta) {
    const row = makeEl('div', 'admin-snapshot');
    const label = makeEl('div', 'admin-snapshot-label');
    label.append(
      makeEl('div', null, `Вернуть расписание от ${formatSnapshotDate(meta.createdAt)}`)
    );
    label.append(
      makeEl(
        'div',
        'admin-sub',
        `перед «${meta.fileName}» · ${formatCount(meta.count)} занятий` +
          (meta.version ? ` · версия ${meta.version}` : '')
      )
    );
    const button = makeEl('button', 'btn ghost small', 'Вернуть');
    button.addEventListener('click', () => restoreSnapshot(meta));
    row.append(label, button);
    return row;
  }

  async function restoreSnapshot(meta) {
    if (busy) return;
    const proceed = window.confirm(
      `Вернуть расписание, которое было опубликовано ${formatSnapshotDate(meta.createdAt)}?\n\n` +
        `В базу вернётся ${formatCount(meta.count)} занятий. Текущее расписание будет заменено, ` +
        'а перед заменой сохранится новый снимок.'
    );
    if (!proceed) return;
    busy = true;
    abortRequested = false;

    // A restore is itself a publish, so it takes its own rollback point.
    await storeSnapshot(`Откат к ${formatSnapshotDate(meta.createdAt)}`);

    publish.disabled = true;
    showRunning('Восстановление снимка…');
    try {
      const snapshot = await snapshots.get(meta.id);
      if (!snapshot || !snapshot.lessons.length) {
        throw new Error('Снимок не найден или пуст');
      }
      const result = await adminService.publishLessons(
        snapshot.lessons,
        { fileName: `Откат к ${formatSnapshotDate(meta.createdAt)}` },
        {
          onProgress: renderProgress,
          shouldAbort: () => abortRequested,
        }
      );
      const count = result && typeof result.count === 'number' ? result.count : 0;
      toast?.show?.(`Восстановлено: ${count} занятий`, 'ok');
      setStatus(
        `↩️ Восстановлено расписание от ${formatSnapshotDate(meta.createdAt)}: ${count} занятий`
      );
      try {
        onPublished?.();
      } catch (err) {
        console.warn('[Admin] post-rollback refresh failed:', err);
      }
    } catch (err) {
      const message =
        err?.code === 'PUBLISH_ABORTED'
          ? err.message
          : 'Не удалось вернуть расписание: ' + (err?.message || String(err));
      setStatus(message);
      toast?.show?.(message, 'bad');
    } finally {
      hideRunning();
      publish.disabled = false;
      publish.textContent = PUBLISH_LABEL;
      busy = false;
      void loadSnapshots();
    }
  }

  root
    .querySelectorAll('[data-close="admin"]')
    .forEach((node) => node.addEventListener('click', close));

  /**
   * Prefills the dialog with a workbook the app already has — currently the
   * file shared into the PWA. The file is only shown once the PIN is accepted,
   * because it lives inside the hidden drop step.
   */
  function stageFile(f) {
    stagedFile = f;
  }

  function show() {
    root.classList.remove('hidden');
    open = true;
    if (stagedFile && !pickedFile) setFile(stagedFile);
    setTimeout(() => pin.focus(), 100);
  }
  function close() {
    root.classList.add('hidden');
    open = false;
    pin.value = '';
    // `stagedFile` and `preview` are kept on purpose: reopening the admin
    // dialog should still offer the shared file, with its report already
    // parsed, instead of making the admin pick and re-parse it.
    pickedFile = null;
    file.value = '';
    picked.classList.add('hidden');
    publish.classList.add('hidden');
    publish.disabled = false;
    publish.textContent = PUBLISH_LABEL;
    previewBox.classList.add('hidden');
    hideRunning();
    stepDrop.classList.add('hidden');
    stepPin.classList.remove('hidden');
    setStatus('');
    errEl.classList.add('hidden');
  }
  function isOpen() {
    return open;
  }

  return { show, close, isOpen, stageFile };
}
