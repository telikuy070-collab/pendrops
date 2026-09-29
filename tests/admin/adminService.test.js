// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../../src/core/application/services/index.ts';

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
    teacher: 'Иванов И.И.',
    room: '101',
    is_exam: false,
    ...overrides,
  };
}

function previewOf(lessons) {
  return {
    draft: {
      lessons,
      report: {
        candidateCount: lessons.length,
        acceptedCount: lessons.length,
        rejectedCount: 0,
        ignoredNonLessonCount: 0,
      },
      diagnostics: [],
    },
    sheets: [{ sheetName: 'СЖ', lessonCount: lessons.length, days: ['Понедельник'], stats: {} }],
    days: ['Понедельник'],
    report: { coverage: 1 },
  };
}

function harness(lessons = [record()]) {
  const parser = {
    previewWorkbook: vi.fn(async () => previewOf(lessons)),
    parseExcel: vi.fn(),
    parseSchedule: vi.fn(),
  };
  const repository = {
    publish: vi.fn(async (rows) => ({ version: 'v1', count: rows.length })),
    publishFromWorkbook: vi.fn(),
  };
  return { service: new AdminService(repository, parser), parser, repository };
}

describe('AdminService preview and publish', () => {
  it('parses the file once and publishes exactly what the preview showed', async () => {
    const { service, parser, repository } = harness([
      record(),
      record({ para: '2', subgroup: '2' }),
    ]);
    const file = new File([new Uint8Array([1, 2, 3])], 'week-38.xls');

    const preview = await service.previewFromExcel(file);
    const result = await service.publishPreview(file);

    expect(parser.previewWorkbook).toHaveBeenCalledTimes(1);
    expect(parser.parseExcel).not.toHaveBeenCalled();
    expect(result.count).toBe(2);
    expect(repository.publish).toHaveBeenCalledTimes(1);
    const [rows, meta] = repository.publish.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sheetId: 'СЖ',
      day: 'Понедельник',
      dayOrder: 0,
      time: '08:30-10:05',
      para: '1',
      group: 'ЛД-11',
      subgroup: '',
      subject: 'Анатомия',
      type: 'lecture',
      teacher: 'Иванов И.И.',
      room: '101',
      isExam: false,
    });
    // A wire null must land as the empty string the previous path wrote.
    expect(rows[1].subgroup).toBe('2');
    expect(meta).toEqual({ fileName: 'week-38.xls', fileSize: 3 });
    expect(preview.draft.lessons).toHaveLength(2);
  });

  it('keeps the preview for a re-publish, so a restart never re-parses', async () => {
    const { service, parser, repository } = harness();
    const file = new File([new Uint8Array([1])], 'week-38.xls');

    await service.previewFromExcel(file);
    await service.publishPreview(file);
    await service.publishPreview(file);

    expect(parser.previewWorkbook).toHaveBeenCalledTimes(1);
    expect(repository.publish).toHaveBeenCalledTimes(2);
  });

  it('refuses to publish a file that was never previewed', async () => {
    const { service, repository } = harness();

    await expect(
      service.publishPreview(new File([new Uint8Array([1])], 'week-38.xls'))
    ).rejects.toThrow('Файл не разобран');
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it('forgets the preview when the admin resets the dialog', async () => {
    const { service, parser, repository } = harness();

    await service.previewFromExcel(new File([new Uint8Array([1])], 'week-38.xls'));
    service.clearPreview();

    await expect(
      service.publishPreview(new File([new Uint8Array([1])], 'week-38.xls'))
    ).rejects.toThrow('Файл не разобран');
    expect(repository.publish).not.toHaveBeenCalled();

    // And the next file is parsed afresh rather than reusing the old draft.
    await service.previewFromExcel(new File([new Uint8Array([1])], 'week-39.xls'));
    expect(parser.previewWorkbook).toHaveBeenCalledTimes(2);
  });

  it('publishes without file metadata when the input is a raw buffer', async () => {
    const { service, repository } = harness();

    await service.publishFromExcel(new ArrayBuffer(4));

    expect(repository.publish.mock.calls[0][1]).toEqual({ fileName: null, fileSize: null });
  });

  it('passes progress and abort hooks through to the repository', async () => {
    const { service, repository } = harness();
    const onProgress = vi.fn();
    const shouldAbort = () => false;

    await service.publishFromExcel(new File([new Uint8Array([1])], 'week-38.xls'), {
      onProgress,
      shouldAbort,
    });

    const [, , options] = repository.publish.mock.calls[0];
    expect(options.onProgress).toBe(onProgress);
    expect(options.shouldAbort()).toBe(false);
  });

  it('restores a snapshot through the same publish path', async () => {
    const { service, repository } = harness();
    const lessons = [
      {
        sheetId: 'СЖ',
        day: 'Пятница',
        dayOrder: 4,
        time: '08:30-10:05',
        para: '1',
        group: 'ЛД-11',
        subgroup: '',
        subject: 'Анатомия',
        type: 'lecture',
        teacher: '',
        room: '',
        isExam: false,
      },
    ];

    const result = await service.publishLessons(lessons, { fileName: 'Откат' });

    expect(result.count).toBe(1);
    expect(repository.publish).toHaveBeenCalledWith(lessons, { fileName: 'Откат' }, undefined);
  });
});
