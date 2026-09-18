import { describe, it, expect, beforeEach } from 'vitest';
import { createCellReader, cellReader, clearFillDownCache } from '../src/parser/cellReader.ts';

describe('CellReader', () => {
  let reader;

  beforeEach(() => {
    reader = createCellReader();
    clearFillDownCache();
  });

  const createRows = (data) => data.map(row => [...row]);

  describe('readCell', () => {
    it('reads simple cell value', () => {
      const rows = [
        ['Header1', 'Header2'],
        ['Value1', 'Value2'],
      ];
      expect(reader.readCell(rows, 1, 0)).toBe('Value1');
      expect(reader.readCell(rows, 1, 1)).toBe('Value2');
    });

    it('returns empty string for out of bounds row', () => {
      const rows = [['A', 'B']];
      expect(reader.readCell(rows, 5, 0)).toBe('');
      expect(reader.readCell(rows, -1, 0)).toBe('');
    });

    it('returns empty string for out of bounds column', () => {
      const rows = [['A', 'B']];
      expect(reader.readCell(rows, 0, 5)).toBe('');
      expect(reader.readCell(rows, 0, -1)).toBe('');
    });

    it('handles null/undefined cells', () => {
      const rows = [['A', null, 'C'], [undefined, 'B', 'D']];
      expect(reader.readCell(rows, 0, 1)).toBe('');
      expect(reader.readCell(rows, 1, 0)).toBe('');
    });

    it('trims whitespace', () => {
      const rows = [['  Value  ']];
      expect(reader.readCell(rows, 0, 0)).toBe('Value');
    });

    it('handles empty string cells', () => {
      const rows = [['A', '', 'C']];
      expect(reader.readCell(rows, 0, 1)).toBe('');
    });
  });

  describe('fill-down (merged cells support)', () => {
    it('fills down from cell above when current is empty', () => {
      const rows = [
        ['Day', 'Time', 'Group1'],
        ['Понедельник', '08:00-09:20', 'Math'],
        ['', '', 'Physics'],  // Day and Time are merged
        ['', '', 'Chemistry'],
      ];

      // Row 2 (index 2) - Day column should fill from row 1
      expect(reader.readCell(rows, 2, 0)).toBe('Понедельник');
      // Row 2 - Time column should fill from row 1
      expect(reader.readCell(rows, 2, 1)).toBe('08:00-09:20');
      // Row 2 - Group1 has its own value
      expect(reader.readCell(rows, 2, 2)).toBe('Physics');

      // Row 3 (index 3) - should also fill from row 1
      expect(reader.readCell(rows, 3, 0)).toBe('Понедельник');
      expect(reader.readCell(rows, 3, 1)).toBe('08:00-09:20');
      expect(reader.readCell(rows, 3, 2)).toBe('Chemistry');
    });

    it('fills down multiple levels', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
        [''],
        [''],
      ];

      expect(reader.readCell(rows, 2, 0)).toBe('Понедельник');
      expect(reader.readCell(rows, 3, 0)).toBe('Понедельник');
      expect(reader.readCell(rows, 4, 0)).toBe('Понедельник');
    });

    it('stops fill-down at new value', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
        ['Вторник'],  // New day starts
        [''],
      ];

      expect(reader.readCell(rows, 2, 0)).toBe('Понедельник');
      expect(reader.readCell(rows, 3, 0)).toBe('Вторник');
      expect(reader.readCell(rows, 4, 0)).toBe('Вторник');
    });

    it('does not fill down if no value above', () => {
      const rows = [
        ['', 'Time'],
        ['', '08:00'],
      ];
      expect(reader.readCell(rows, 1, 0)).toBe('');
    });

    it('works independently per column', () => {
      const rows = [
        ['Day', 'Group1', 'Group2'],
        ['Понедельник', 'Math', 'Physics'],
        ['', 'Chemistry', ''],  // Day fills, Group1 has value, Group2 fills
      ];

      expect(reader.readCell(rows, 2, 0)).toBe('Понедельник');  // fill-down
      expect(reader.readCell(rows, 2, 1)).toBe('Chemistry');    // own value
      expect(reader.readCell(rows, 2, 2)).toBe('Physics');      // fill-down
    });
  });

  describe('readCellWithContext', () => {
    it('returns context for non-merged cell', () => {
      const rows = [['A', 'B'], ['C', 'D']];
      const result = reader.readCellWithContext(rows, 1, 0);
      expect(result.value).toBe('C');
      expect(result.isMerged).toBe(false);
      expect(result.sourceRow).toBe(1);
    });

    it('returns context for merged cell (fill-down)', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      const result = reader.readCellWithContext(rows, 2, 0);
      expect(result.value).toBe('Понедельник');
      expect(result.isMerged).toBe(true);
      expect(result.sourceRow).toBe(1);
    });

    it('returns context for empty cell with no fill-down source', () => {
      const rows = [['', '']];
      const result = reader.readCellWithContext(rows, 0, 0);
      expect(result.value).toBe('');
      expect(result.isMerged).toBe(false);
      expect(result.sourceRow).toBe(-1);
    });

    it('uses cache for subsequent calls', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      // First call
      const result1 = reader.readCellWithContext(rows, 2, 0);
      // Second call should use cache
      const result2 = reader.readCellWithContext(rows, 2, 0);
      expect(result1.value).toBe(result2.value);
      expect(result1.isMerged).toBe(result2.isMerged);
      expect(result1.sourceRow).toBe(result2.sourceRow);
    });

    it('correctly identifies merged vs non-merged from cache', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      // First read the source row (non-merged)
      reader.readCellWithContext(rows, 1, 0);
      // Then read the merged row
      const result = reader.readCellWithContext(rows, 2, 0);
      expect(result.isMerged).toBe(true);
      expect(result.sourceRow).toBe(1);
    });
  });

  describe('cache behavior', () => {
    it('caches readCell results', () => {
      const rows = [['A', 'B'], ['C', 'D']];
      reader.readCell(rows, 1, 0);
      // Modify rows - cached value should be returned
      rows[1][0] = 'MODIFIED';
      expect(reader.readCell(rows, 1, 0)).toBe('C');
    });

    it('caches readCellWithContext results', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      reader.readCellWithContext(rows, 2, 0);
      rows[1][0] = 'MODIFIED';
      const result = reader.readCellWithContext(rows, 2, 0);
      expect(result.value).toBe('Понедельник');
    });

    it('clearFillDownCache clears the cache', () => {
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      reader.readCell(rows, 2, 0);
      clearFillDownCache();
      // After clear, should re-read from rows
      rows[1][0] = 'Вторник';
      expect(reader.readCell(rows, 2, 0)).toBe('Вторник');
    });

    it('each reader instance has independent cache', () => {
      const reader1 = createCellReader();
      const reader2 = createCellReader();
      const rows = [
        ['Day'],
        ['Понедельник'],
        [''],
      ];
      reader1.readCell(rows, 2, 0);
      expect(reader2.readCell(rows, 2, 0)).toBe('Понедельник'); // reader2 has its own cache
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton cellReader', () => {
      expect(cellReader).toBeDefined();
      expect(typeof cellReader.readCell).toBe('function');
      expect(typeof cellReader.readCellWithContext).toBe('function');
      expect(cellReader.fillDownCache).toBeInstanceOf(Map);
    });
  });

  describe('edge cases', () => {
    it('handles rows with varying column counts', () => {
      const rows = [
        ['A', 'B', 'C'],
        ['D'],  // Only 1 column
        ['E', 'F'],
      ];
      expect(reader.readCell(rows, 1, 0)).toBe('D');
      expect(reader.readCell(rows, 1, 1)).toBe(''); // Out of bounds for this row
      expect(reader.readCell(rows, 1, 2)).toBe(''); // Out of bounds for this row
    });

    it('handles completely empty rows array', () => {
      const rows = [];
      expect(reader.readCell(rows, 0, 0)).toBe('');
    });

    it('handles null rows array', () => {
      expect(reader.readCell(null, 0, 0)).toBe('');
    });

    it('handles undefined rows array', () => {
      expect(reader.readCell(undefined, 0, 0)).toBe('');
    });

    it('handles numeric cell values', () => {
      const rows = [[1, 2], [3, 4]];
      expect(reader.readCell(rows, 1, 0)).toBe('3');
      expect(reader.readCell(rows, 1, 1)).toBe('4');
    });
  });
});