import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormatRegistry } from '../src/parser/registry.ts';
import { validateFormatConfig, safeValidateFormatConfig, FormatConfigSchema } from '../src/parser/types.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load JSON formats using fs
const collegeFormat = JSON.parse(readFileSync(resolve(__dirname, '../src/parser/formats/college-kyrgyz-2024.json'), 'utf-8'));
const genericFormat = JSON.parse(readFileSync(resolve(__dirname, '../src/parser/formats/generic.json'), 'utf-8'));

describe('FormatConfig Zod Schema', () => {
  it('validates college-kyrgyz-2024.json', () => {
    const result = safeValidateFormatConfig(collegeFormat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatId).toBe('college-kyrgyz-2024');
      expect(result.data.name).toBe('Кыргызский медицинский колледж 2024');
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('validates generic.json', () => {
    const result = safeValidateFormatConfig(genericFormat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatId).toBe('generic');
      expect(result.data.name).toBe('Generic Schedule Format');
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('rejects invalid formatId (empty)', () => {
    const invalid = { ...collegeFormat, formatId: '' };
    const result = safeValidateFormatConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid version (not semver)', () => {
    const invalid = { ...collegeFormat, version: '1.0' };
    const result = safeValidateFormatConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects missing detection.headerKeywords', () => {
    const invalid = { ...collegeFormat, detection: { ...collegeFormat.detection, headerKeywords: [] } };
    const result = safeValidateFormatConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid mergedCellsStrategy', () => {
    const invalid = { ...collegeFormat, parsing: { ...collegeFormat.parsing, mergedCellsStrategy: 'invalid' } };
    const result = safeValidateFormatConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts valid mergedCellsStrategy values', () => {
    for (const strategy of ['fill_down', 'ignore']) {
      const valid = { ...collegeFormat, parsing: { ...collegeFormat.parsing, mergedCellsStrategy: strategy } };
      const result = safeValidateFormatConfig(valid);
      expect(result.success).toBe(true);
    }
  });

  it('validates transforms array', () => {
    const result = safeValidateFormatConfig(collegeFormat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.transforms)).toBe(true);
      expect(result.data.transforms.length).toBeGreaterThan(0);
      for (const t of result.data.transforms) {
        expect(typeof t.type).toBe('string');
        expect(t.type.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('FormatRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new FormatRegistry();
  });

  it('registers and retrieves a format', () => {
    registry.register(collegeFormat);
    const format = registry.get('college-kyrgyz-2024');
    expect(format).toBeDefined();
    expect(format?.formatId).toBe('college-kyrgyz-2024');
    expect(format?.name).toBe('Кыргызский медицинский колледж 2024');
  });

  it('throws on duplicate registration', () => {
    registry.register(collegeFormat);
    expect(() => registry.register(collegeFormat)).toThrow('already registered');
  });

  it('registerOrReplace overwrites existing', () => {
    registry.register(collegeFormat);
    const modified = { ...collegeFormat, name: 'Modified Name' };
    registry.registerOrReplace(modified);
    const format = registry.get('college-kyrgyz-2024');
    expect(format?.name).toBe('Modified Name');
  });

  it('returns undefined for unknown format', () => {
    const format = registry.get('unknown');
    expect(format).toBeUndefined();
  });

  it('getAll returns all registered formats', () => {
    registry.register(collegeFormat);
    registry.register(genericFormat);
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(f => f.formatId).sort()).toEqual(['college-kyrgyz-2024', 'generic']);
  });

  it('getDefault returns first registered format', () => {
    registry.register(collegeFormat);
    registry.register(genericFormat);
    const def = registry.getDefault();
    expect(def.formatId).toBe('college-kyrgyz-2024');
  });

  it('throws when getting default from empty registry', () => {
    expect(() => registry.getDefault()).toThrow('No default format registered');
  });

  it('setDefault changes default format', () => {
    registry.register(collegeFormat);
    registry.register(genericFormat);
    registry.setDefault('generic');
    const def = registry.getDefault();
    expect(def.formatId).toBe('generic');
  });

  it('setDefault throws for unknown format', () => {
    registry.register(collegeFormat);
    expect(() => registry.setDefault('unknown')).toThrow('not found');
  });

  it('has returns true for registered formats', () => {
    registry.register(collegeFormat);
    expect(registry.has('college-kyrgyz-2024')).toBe(true);
    expect(registry.has('generic')).toBe(false);
  });

  it('delete removes format', () => {
    registry.register(collegeFormat);
    registry.register(genericFormat);
    const deleted = registry.delete('college-kyrgyz-2024');
    expect(deleted).toBe(true);
    expect(registry.has('college-kyrgyz-2024')).toBe(false);
    expect(registry.size).toBe(1);
  });

  it('delete returns false for unknown format', () => {
    const deleted = registry.delete('unknown');
    expect(deleted).toBe(false);
  });

  it('delete updates default if deleted format was default', () => {
    registry.register(collegeFormat);
    registry.register(genericFormat);
    registry.delete('college-kyrgyz-2024');
    const def = registry.getDefault();
    expect(def.formatId).toBe('generic');
  });

  it('clear empties registry', () => {
    registry.register(collegeFormat);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.defaultFormatId).toBeNull();
  });

  it('size returns correct count', () => {
    expect(registry.size).toBe(0);
    registry.register(collegeFormat);
    expect(registry.size).toBe(1);
    registry.register(genericFormat);
    expect(registry.size).toBe(2);
  });

  it('defaultFormatId returns current default', () => {
    expect(registry.defaultFormatId).toBeNull();
    registry.register(collegeFormat);
    expect(registry.defaultFormatId).toBe('college-kyrgyz-2024');
  });
});

describe('Global formatRegistry singleton', () => {
  it('can be imported and used', async () => {
    const { formatRegistry } = await import('../src/parser/registry.ts');
    expect(formatRegistry).toBeInstanceOf(FormatRegistry);
  });
});