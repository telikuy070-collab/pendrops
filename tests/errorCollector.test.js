import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCollector, errorCollector, logParseError } from '../src/parser/errorCollector.ts';

describe('ErrorCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new ErrorCollector({ maxErrors: 100, maxExamplesPerPattern: 3 });
  });

  describe('record', () => {
    it('records an error with all fields', () => {
      const error = collector.record('Test error', {
        rawText: 'some text',
        rowIndex: 5,
        colIndex: 2,
        sheetName: 'Sheet1',
        parserStage: 'main',
        lessonData: { subject: 'Math' },
      });

      expect(error.id).toMatch(/^err_\d+_\d+$/);
      expect(error.type).toBe('parse');
      expect(error.message).toBe('Test error');
      expect(error.context.rawText).toBe('some text');
      expect(error.context.rowIndex).toBe(5);
      expect(error.context.colIndex).toBe(2);
      expect(error.context.sheetName).toBe('Sheet1');
      expect(error.context.parserStage).toBe('main');
      expect(error.context.lessonData).toEqual({ subject: 'Math' });
      expect(error.timestamp).toBeGreaterThan(0);
    });

    it('records error from Error object', () => {
      const err = new Error('Something went wrong');
      err.stack = 'Error stack trace';
      const error = collector.record(err, { rowIndex: 1 });
      expect(error.message).toBe('Something went wrong');
      expect(error.stack).toBe('Error stack trace');
    });

    it('records string error', () => {
      const error = collector.record('Simple string error');
      expect(error.message).toBe('Simple string error');
      expect(error.stack).toBeUndefined();
    });

    it('defaults parserStage to parse type', () => {
      const error = collector.record('Error without stage');
      expect(error.type).toBe('parse');
    });

    it('sets fallback type for non-main stage', () => {
      const error = collector.record('Fallback error', { parserStage: 'simple' });
      expect(error.type).toBe('fallback');
    });

    it('includes meta in error', () => {
      const error = collector.record('Error with meta', { meta: { key: 'value' } });
      expect(error.meta).toEqual({ key: 'value' });
    });
  });

  describe('getErrors', () => {
    it('returns all errors', () => {
      collector.record('Error 1');
      collector.record('Error 2');
      const errors = collector.getErrors();
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toBe('Error 1');
      expect(errors[1].message).toBe('Error 2');
    });

    it('returns copy of errors array', () => {
      collector.record('Error 1');
      const errors = collector.getErrors();
      errors.push({});
      expect(collector.getErrors()).toHaveLength(1);
    });
  });

  describe('getErrorsByType', () => {
    it('filters errors by type', () => {
      collector.record('Parse error', { parserStage: 'main' });
      collector.record('Fallback error', { parserStage: 'simple' });
      collector.record('Another parse error', { parserStage: 'main' });

      const parseErrors = collector.getErrorsByType('parse');
      const fallbackErrors = collector.getErrorsByType('fallback');

      expect(parseErrors).toHaveLength(2);
      expect(fallbackErrors).toHaveLength(1);
    });
  });

  describe('getRecentErrors', () => {
    it('returns last N errors', () => {
      for (let i = 1; i <= 10; i++) {
        collector.record(`Error ${i}`);
      }
      const recent = collector.getRecentErrors(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].message).toBe('Error 8');
      expect(recent[2].message).toBe('Error 10');
    });

    it('returns all errors if less than limit', () => {
      collector.record('Error 1');
      collector.record('Error 2');
      const recent = collector.getRecentErrors(10);
      expect(recent).toHaveLength(2);
    });

    it('defaults to 50', () => {
      for (let i = 1; i <= 60; i++) {
        collector.record(`Error ${i}`);
      }
      const recent = collector.getRecentErrors();
      expect(recent).toHaveLength(50);
    });
  });

  describe('pattern analysis', () => {
    it('groups similar errors into patterns', () => {
      collector.record('Failed to parse group СЖ-1-25', { rowIndex: 1 });
      collector.record('Failed to parse group ФЯ-2-24', { rowIndex: 2 });
      collector.record('Failed to parse group ЛД-3-23', { rowIndex: 3 });

      const patterns = collector.getPatterns(2);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(3);
      expect(patterns[0].pattern).toContain('<group>');
    });

    it('normalizes teacher names in patterns', () => {
      collector.record('Failed to extract teacher Иванов И.И.', { rowIndex: 1 });
      collector.record('Failed to extract teacher Петров П.П.', { rowIndex: 2 });

      const patterns = collector.getPatterns(2);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toContain('<teacher>');
    });

    it('normalizes room patterns', () => {
      collector.record('Invalid room №7 корпус 315', { rowIndex: 1 });
      collector.record('Invalid room №3 корпус 205', { rowIndex: 2 });

      const patterns = collector.getPatterns(2);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toContain('<room>');
    });

    it('normalizes numbers', () => {
      collector.record('Error at row 5', { rowIndex: 5 });
      collector.record('Error at row 10', { rowIndex: 10 });

      const patterns = collector.getPatterns(2);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toContain('<num>');
    });

    it('stores examples up to maxExamplesPerPattern', () => {
      for (let i = 1; i <= 5; i++) {
        collector.record(`Same error ${i}`, { rowIndex: i });
      }
      const patterns = collector.getPatterns(2);
      expect(patterns[0].examples).toHaveLength(3); // maxExamplesPerPattern = 3
    });

    it('getTopPatterns returns top N patterns', () => {
      collector.record('Error A', { rowIndex: 1 });
      collector.record('Error A', { rowIndex: 2 });
      collector.record('Error B', { rowIndex: 3 });
      collector.record('Error C', { rowIndex: 4 });
      collector.record('Error C', { rowIndex: 5 });
      collector.record('Error C', { rowIndex: 6 });

      const top = collector.getTopPatterns(2);
      expect(top).toHaveLength(2);
      expect(top[0].pattern).toContain('error c');
      expect(top[1].pattern).toContain('error a');
    });
  });

  describe('getStats', () => {
    it('returns stats by error type', () => {
      collector.record('Parse 1', { parserStage: 'main' });
      collector.record('Parse 2', { parserStage: 'main' });
      collector.record('Fallback 1', { parserStage: 'simple' });
      collector.record('Validation 1', { parserStage: 'main' }); // Will be 'parse' type

      const stats = collector.getStats();
      expect(stats.parse).toBe(3); // main stage defaults to parse
      expect(stats.fallback).toBe(1);
      expect(stats.validation).toBe(0);
      expect(stats.extraction).toBe(0);
      expect(stats.classification).toBe(0);
    });
  });

  describe('clear', () => {
    it('clears all errors and patterns', () => {
      collector.record('Error 1');
      collector.record('Error 2');
      collector.clear();
      expect(collector.getErrors()).toHaveLength(0);
      expect(collector.getPatterns()).toHaveLength(0);
    });

    it('resets error ID counter', () => {
      collector.record('Error 1');
      collector.clear();
      const error = collector.record('Error 2');
      expect(error.id).toMatch(/^err_\d+_1$/); // Counter reset to 1
    });
  });

  describe('export/import', () => {
    it('exports all data', () => {
      collector.record('Error 1', { rowIndex: 1 });
      collector.record('Error 2', { rowIndex: 2 });

      const exported = collector.export();
      expect(exported.errors).toHaveLength(2);
      expect(exported.patterns).toHaveLength(1);
      expect(exported.stats.parse).toBe(2);
      expect(exported.exportedAt).toBeGreaterThan(0);
    });

    it('imports errors and patterns', () => {
      const data = {
        errors: [
          {
            id: 'err_1',
            type: 'parse',
            message: 'Imported error',
            context: {},
            timestamp: Date.now(),
          },
        ],
        patterns: [
          {
            pattern: 'imported pattern',
            count: 5,
            examples: [],
            lastSeen: Date.now(),
            type: 'parse',
          },
        ],
      };

      collector.import(data);
      expect(collector.getErrors()).toHaveLength(1);
      expect(collector.getErrors()[0].message).toBe('Imported error');
      expect(collector.getPatterns()).toHaveLength(1);
    });

    it('limits imported errors to maxErrors', () => {
      const collector2 = new ErrorCollector({ maxErrors: 2 });
      const data = {
        errors: [
          { id: '1', type: 'parse', message: 'E1', context: {}, timestamp: 1 },
          { id: '2', type: 'parse', message: 'E2', context: {}, timestamp: 2 },
          { id: '3', type: 'parse', message: 'E3', context: {}, timestamp: 3 },
        ],
      };
      collector2.import(data);
      expect(collector2.getErrors()).toHaveLength(2);
      expect(collector2.getErrors()[0].message).toBe('E2');
      expect(collector2.getErrors()[1].message).toBe('E3');
    });
  });

  describe('maxErrors limit', () => {
    it('limits total errors to maxErrors', () => {
      const limitedCollector = new ErrorCollector({ maxErrors: 3 });
      limitedCollector.record('Error 1');
      limitedCollector.record('Error 2');
      limitedCollector.record('Error 3');
      limitedCollector.record('Error 4'); // Should remove Error 1

      expect(limitedCollector.getErrors()).toHaveLength(3);
      expect(limitedCollector.getErrors()[0].message).toBe('Error 2');
      expect(limitedCollector.getErrors()[2].message).toBe('Error 4');
    });
  });

  describe('onError callback', () => {
    it('calls onError callback for each error', () => {
      const callback = vi.fn();
      const collectorWithCallback = new ErrorCollector({ onError: callback });

      collectorWithCallback.record('Error 1');
      collectorWithCallback.record('Error 2');

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[0][0].message).toBe('Error 1');
      expect(callback.mock.calls[1][0].message).toBe('Error 2');
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton errorCollector', () => {
      expect(errorCollector).toBeInstanceOf(ErrorCollector);
    });

    it('logParseError uses singleton', () => {
      const error = logParseError('Test error', { rowIndex: 1 });
      expect(error.message).toBe('Test error');
      expect(errorCollector.getErrors()).toContainEqual(
        expect.objectContaining({ message: 'Test error' })
      );
    });
  });
});