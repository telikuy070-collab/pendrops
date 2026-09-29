// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminView } from '../../src/view/adminView.js';

function stats(overrides = {}) {
  return {
    totalRows: 20,
    headerRow: 3,
    headerRows: [3],
    regionCount: 1,
    groupsFound: 2,
    candidateCount: 12,
    acceptedCount: 10,
    rejectedCount: 2,
    ignoredNonLessonCount: 4,
    totalNonEmpty: 30,
    inRegions: 20,
    outOfRegions: 10,
    lessonCells: 8,
    partialCells: 2,
    nonLessonCells: 4,
    unresolvedCells: 0,
    coverage: 1,
    mergeCount: 2,
    mergeExpandedCount: 2,
    mergeExpandedCells: 4,
    mergeRowsCovered: 2,
    mergeColumnsCovered: 2,
    expandedGroupCells: 10,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    sheet_id: 'СЖ',
    day: 'Понедельник',
    day_order: 0,
    time: '08:30-10:05',
    para: '1',
    group_code: 'ЛД-11',
    subgroup: null,
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов',
    room: '101',
    is_exam: false,
    ...overrides,
  };
}

function previewOf() {
  return {
    draft: {
      lessons: [record(), record({ para: '2' })],
      report: { candidateCount: 2, acceptedCount: 2, rejectedCount: 0, ignoredNonLessonCount: 0 },
      diagnostics: [],
    },
    sheets: [{ sheetName: 'СЖ', lessonCount: 2, days: ['Понедельник'], stats: stats() }],
    days: ['Понедельник'],
    report: { ...stats(), sheetCount: 1, acceptedCount: 2 },
  };
}

function currentSchedule(lessons = [record()]) {
  return {
    sheets: new Map([['СЖ', lessons]]),
    sheetsMeta: [],
    groups: new Map(),
    preferences: { currentSheetId: '', currentGroup: '', activeSubgroup: '', hiddenSheets: [] },
    version: 'v7',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

/** The parts of the dialog the tests poke at. */
function read() {
  const q = (selector) => document.querySelector(selector);
  return {
    stepPin: q('#stepPin'),
    stepDrop: q('#stepDrop'),
    pin: q('#adminPin'),
    pinBtn: q('#adminPinBtn'),
    publish: q('#adminPublish'),
    preview: q('#adminPreview'),
    previewText: q('#adminPreview').textContent,
    status: q('#adminStatus'),
    running: q('#adminRunning'),
    progressLabel: q('#adminProgressLabel'),
    cancel: q('#adminCancel'),
    cancelNote: q('#adminCancelNote'),
    snapshotList: q('#adminSnapshotList'),
    reset: q('#adminReset'),
  };
}

let adminService;
let authService;
let toast;
let onPublished;
let snapshots;
let resolvePreview;

function setup() {
  return createAdminView(authService, adminService, toast, onPublished, {
    getCurrentSchedule: () => currentSchedule(),
    snapshots,
  });
}

const NBSP = '\u00a0';

/** Lets every queued microtask and promise continuation settle. */
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** Opens the dialog and walks through the PIN gate. */
async function openAndUnlock(view) {
  view.show();
  read().pin.value = '1234';
  read().pinBtn.click();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.confirm = vi.fn(() => true);
  authService = { verifyPin: vi.fn(async () => true) };
  toast = { show: vi.fn() };
  onPublished = vi.fn();
  resolvePreview = null;
  adminService = {
    previewFromExcel: vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePreview = () => resolve(previewOf());
        })
    ),
    publishPreview: vi.fn(async () => ({ version: 'v8', count: 2 })),
    publishLessons: vi.fn(async () => ({ version: 'v9', count: 2 })),
    clearPreview: vi.fn(),
  };
  snapshots = {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    get: vi.fn(async () => null),
  };
});

describe('admin dialog: the PIN gate', () => {
  it('keeps the file step hidden until the PIN is accepted', async () => {
    const view = setup();

    view.show();
    expect(read().stepDrop.classList.contains('hidden')).toBe(true);
    expect(read().stepPin.classList.contains('hidden')).toBe(false);

    await openAndUnlock(view);

    expect(read().stepPin.classList.contains('hidden')).toBe(true);
    expect(read().stepDrop.classList.contains('hidden')).toBe(false);
  });

  it('rejects a wrong PIN and keeps the file step hidden', async () => {
    authService.verifyPin = vi.fn(async () => false);
    const view = setup();

    view.show();
    read().pin.value = '0000';
    read().pinBtn.click();
    await flush();
    await flush();

    expect(document.querySelector('#adminError').classList.contains('hidden')).toBe(false);
    expect(read().stepDrop.classList.contains('hidden')).toBe(true);
  });
});

describe('admin dialog: the preview', () => {
  it('blocks publishing until the file has been parsed', async () => {
    const view = setup();
    await openAndUnlock(view);

    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();

    expect(read().publish.disabled).toBe(true);
    expect(read().status.textContent).toContain('Разбираю');

    resolvePreview();
    await flush();

    expect(read().publish.disabled).toBe(false);
  });

  it('shows the counts, the coverage and the comparison', async () => {
    const view = setup();
    await openAndUnlock(view);
    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();
    resolvePreview();
    await flush();

    const { previewText } = read();
    expect(previewText).toContain('Будет опубликовано: 2 занятий');
    expect(previewText).toContain('Покрытие разбора: 100%');
    expect(previewText).toContain('Дни недели: Понедельник');
    expect(previewText).toContain('Сейчас 1 → станет 2');
    // The engine's own counters, carried through.
    expect(previewText).toContain('объединений: 2');
    expect(previewText).toContain('отклонено: 2');
  });

  it('parses the file once and publishes the very same preview', async () => {
    const view = setup();
    await openAndUnlock(view);
    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();
    resolvePreview();
    await flush();

    read().publish.click();
    await flush();
    await flush();

    expect(adminService.previewFromExcel).toHaveBeenCalledTimes(1);
    expect(adminService.publishPreview).toHaveBeenCalledTimes(1);
    expect(adminService.publishPreview.mock.calls[0][0].name).toBe('week-38.xls');
  });

  it('keeps a staged file and its preview across close and reopen', async () => {
    const view = setup();
    await openAndUnlock(view);
    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();
    resolvePreview();
    await flush();

    view.close();
    expect(read().publish.classList.contains('hidden')).toBe(true);

    view.show();

    // Reopening must not read a multi-megabyte workbook a second time.
    expect(adminService.previewFromExcel).toHaveBeenCalledTimes(1);
    expect(read().preview.classList.contains('hidden')).toBe(false);
    expect(read().publish.disabled).toBe(false);
  });

  it('does not offer a failed parse for publishing', async () => {
    adminService.previewFromExcel = vi.fn(async () => {
      throw new Error('Workbook имеет неверную структуру');
    });
    const view = setup();
    await openAndUnlock(view);

    view.stageFile(new File([new Uint8Array([1])], 'broken.xls'));
    view.show();
    await flush();

    expect(read().publish.disabled).toBe(true);
    expect(read().status.textContent).toContain('Не удалось разобрать файл');
    expect(toast.show).toHaveBeenCalled();
  });

  it('clears the preview when the admin resets the dialog', async () => {
    const view = setup();
    await openAndUnlock(view);
    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();
    resolvePreview();
    await flush();

    read().reset.click();

    expect(read().preview.classList.contains('hidden')).toBe(true);
    expect(read().publish.classList.contains('hidden')).toBe(true);
    expect(adminService.clearPreview).toHaveBeenCalled();
  });
});

describe('admin dialog: publishing, progress and cancelling', () => {
  async function readyToPublish() {
    const view = setup();
    await openAndUnlock(view);
    view.stageFile(new File([new Uint8Array([1])], 'week-38.xls'));
    view.show();
    resolvePreview();
    await flush();
    return view;
  }

  it('blocks a second click while a publish is running and shows the progress', async () => {
    let options;
    let finish;
    adminService.publishPreview = vi.fn((_file, passed) => {
      options = passed;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await readyToPublish();

    read().publish.click();
    await flush();
    await flush();
    expect(read().publish.disabled).toBe(true);
    expect(read().running.classList.contains('hidden')).toBe(false);

    options.onProgress({ uploaded: 400, total: 1200, chunk: 1, chunks: 3, done: false });
    // The thousands separator is a non-breaking space, as `formatCount` writes it.
    expect(read().progressLabel.textContent).toContain(`Загружено 400 из 1${NBSP}200`);
    expect(read().progressLabel.textContent).toContain('запрос 1 из 3');

    // A second click while the first is in flight must do nothing.
    read().publish.click();
    expect(adminService.publishPreview).toHaveBeenCalledTimes(1);

    finish({ version: 'v8', count: 2 });
    await flush();
    expect(read().running.classList.contains('hidden')).toBe(true);
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it('saves a snapshot before the first row is written', async () => {
    await readyToPublish();

    read().publish.click();
    await flush();

    expect(snapshots.save).toHaveBeenCalledTimes(1);
    expect(snapshots.save.mock.calls[0][0]).toMatchObject({
      fileName: 'week-38.xls',
      version: 'v7',
      count: 1,
    });
    expect(snapshots.save.mock.invocationCallOrder[0]).toBeLessThan(
      adminService.publishPreview.mock.invocationCallOrder[0]
    );
  });

  it('asks first and then reports the leftover rows honestly', async () => {
    let options;
    let failPublish;
    adminService.publishPreview = vi.fn((_file, passed) => {
      options = passed;
      return new Promise((_resolve, reject) => {
        failPublish = reject;
      });
    });
    await readyToPublish();

    read().publish.click();
    await flush();

    expect(options.shouldAbort()).toBe(false);
    read().cancel.click();
    expect(window.confirm).toHaveBeenCalled();
    expect(options.shouldAbort()).toBe(true);
    expect(read().cancelNote.textContent).toContain('Останавливаю');

    // The repository refuses at the next chunk boundary, once the abort is seen.
    failPublish(
      Object.assign(new Error('Публикация остановлена: загружено 400 из 1200.'), {
        code: 'PUBLISH_ABORTED',
      })
    );
    await flush();

    const status = read().status.textContent;
    expect(status).toContain('Публикация остановлена: загружено 400 из 1200.');
    expect(status).toContain('уберёт загруженный кусок');
    // The button comes back so a full re-publish can clean the leftovers up.
    expect(read().publish.disabled).toBe(false);
  });

  it('restores a snapshot through the same publish path', async () => {
    snapshots.list = vi.fn(async () => [
      {
        id: '2026-09-29T10:00:00.000Z',
        createdAt: '2026-09-29T10:00:00.000Z',
        fileName: 'week-37.xls',
        version: 'v6',
        count: 1854,
      },
    ]);
    snapshots.get = vi.fn(async () => ({
      id: '2026-09-29T10:00:00.000Z',
      createdAt: '2026-09-29T10:00:00.000Z',
      fileName: 'week-37.xls',
      version: 'v6',
      count: 1,
      lessons: [{ sheetId: 'СЖ' }],
    }));
    const view = setup();
    await openAndUnlock(view);

    expect(read().snapshotList.textContent).toContain('Вернуть расписание от');
    expect(read().snapshotList.textContent).toContain('week-37.xls');

    read().snapshotList.querySelector('button').click();
    await flush();

    expect(adminService.publishLessons).toHaveBeenCalledTimes(1);
    expect(adminService.publishLessons.mock.calls[0][0]).toEqual([{ sheetId: 'СЖ' }]);
    expect(adminService.publishLessons.mock.calls[0][1].fileName).toContain('Откат');
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it('says plainly that the rollback is local to this device', async () => {
    const view = setup();
    await openAndUnlock(view);

    const note = document.querySelector('#adminSnapshotNote').textContent;
    expect(note).toContain('только на этом устройстве');
    expect(note).toContain('очистки данных отката не будет');
  });

  it('does not offer a rollback point when the browser refuses local storage', async () => {
    snapshots.list = vi.fn(async () => {
      throw new Error('IndexedDB недоступен');
    });
    const view = setup();
    await openAndUnlock(view);
    await flush();

    expect(document.querySelector('#adminSnapshotList').textContent).toContain(
      'Не удалось прочитать снимки'
    );
  });
});
