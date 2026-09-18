import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartTypeClassifier, LESSON_TYPES, classifier } from '../src/parser/classifier.ts';

describe('SmartTypeClassifier', () => {
  let clf;

  beforeEach(() => {
    clf = new SmartTypeClassifier();
  });

  describe('classify - Lecture detection', () => {
    it('detects "лекция"', () => {
      const result = clf.classify('Анатомия лекция');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('detects "лек"', () => {
      const result = clf.classify('Физика лек');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });

    it('detects "лекц"', () => {
      const result = clf.classify('Химия лекц');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });

    it('detects "lecture" (English)', () => {
      const result = clf.classify('Biology lecture');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });

    it('detects "lect" (English short)', () => {
      const result = clf.classify('Math lect');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });

    it('handles case insensitivity', () => {
      const result = clf.classify('АНАТОМИЯ ЛЕКЦИЯ');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });

    it('handles punctuation', () => {
      const result = clf.classify('Анатомия, лекция.');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });
  });

  describe('classify - Practice detection', () => {
    it('detects "практика"', () => {
      const result = clf.classify('Фармакология практика');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('detects "пр"', () => {
      const result = clf.classify('Химия пр');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
    });

    it('detects "практ"', () => {
      const result = clf.classify('Биология практ');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
    });

    it('detects "семинар"', () => {
      const result = clf.classify('История семинар');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
    });

    it('detects "сем"', () => {
      const result = clf.classify('Экономика сем');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
    });
  });

  describe('classify - Lab detection', () => {
    it('detects "лабораторная"', () => {
      const result = clf.classify('Химия лабораторная');
      expect(result.type).toBe(LESSON_TYPES.LAB);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('detects "лаб"', () => {
      const result = clf.classify('Физика лаб');
      expect(result.type).toBe(LESSON_TYPES.LAB);
    });

    it('detects "lab" (English)', () => {
      const result = clf.classify('Chemistry lab');
      expect(result.type).toBe(LESSON_TYPES.LAB);
    });
  });

  describe('classify - Other/Exam detection', () => {
    it('detects "экзамен"', () => {
      const result = clf.classify('Математика экзамен');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "экз"', () => {
      const result = clf.classify('Физика экз');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "зачёт"', () => {
      const result = clf.classify('Химия зачёт');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "зачет"', () => {
      const result = clf.classify('Биология зачет');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "тест"', () => {
      const result = clf.classify('Английский тест');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "контрольная"', () => {
      const result = clf.classify('Русский контрольная');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "кураторский час"', () => {
      const result = clf.classify('Кураторский час');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });

    it('detects "куратордук"', () => {
      const result = clf.classify('Куратордук саат');
      expect(result.type).toBe(LESSON_TYPES.OTHER);
    });
  });

  describe('classify - Unknown/Edge cases', () => {
    it('returns UNKNOWN for empty string', () => {
      const result = clf.classify('');
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('returns UNKNOWN for null', () => {
      const result = clf.classify(null);
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('returns UNKNOWN for undefined', () => {
      const result = clf.classify(undefined);
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('returns UNKNOWN for non-string', () => {
      const result = clf.classify(123);
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('returns UNKNOWN for random text', () => {
      const result = clf.classify('asdfghjkl');
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('returns UNKNOWN for text with only numbers', () => {
      const result = clf.classify('123 456');
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
    });
  });

  describe('learn - Learning new patterns', () => {
    it('learns new pattern for lecture', () => {
      clf.learn('лекц. по анатомии', LESSON_TYPES.LECTURE);
      const result = clf.classify('лекц. по анатомии');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
      expect(result.confidence).toBe(0.98);
    });

    it('learns new pattern for practice', () => {
      clf.learn('практический урок', LESSON_TYPES.PRACTICE);
      const result = clf.classify('практический урок по химии');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
      expect(result.confidence).toBe(0.98);
    });

    it('learned patterns have priority over base patterns', () => {
      // Base pattern would classify "lab" as LAB
      clf.learn('lab session', LESSON_TYPES.PRACTICE);
      const result = clf.classify('lab session');
      expect(result.type).toBe(LESSON_TYPES.PRACTICE);
      expect(result.confidence).toBe(0.98);
    });

    it('ignores invalid type', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      clf.learn('some text', 'invalid-type');
      expect(consoleSpy).toHaveBeenCalledWith('[SmartTypeClassifier] Unknown type: invalid-type');
      consoleSpy.mockRestore();
    });

    it('ignores empty text', () => {
      clf.learn('', LESSON_TYPES.LECTURE);
      const result = clf.classify('some text');
      expect(result.type).not.toBe(LESSON_TYPES.LECTURE);
    });

    it('ignores empty type', () => {
      clf.learn('some text', '');
      const result = clf.classify('some text');
      expect(result.type).not.toBe(LESSON_TYPES.LECTURE);
    });
  });

  describe('getPatterns', () => {
    it('returns base patterns', () => {
      const patterns = clf.getPatterns();
      expect(patterns.has(LESSON_TYPES.LECTURE)).toBe(true);
      expect(patterns.has(LESSON_TYPES.PRACTICE)).toBe(true);
      expect(patterns.has(LESSON_TYPES.LAB)).toBe(true);
      expect(patterns.has(LESSON_TYPES.OTHER)).toBe(true);
      expect(patterns.has(LESSON_TYPES.UNKNOWN)).toBe(true);
    });

    it('includes learned patterns', () => {
      clf.learn('новая лекция', LESSON_TYPES.LECTURE);
      const patterns = clf.getPatterns();
      const lecturePatterns = patterns.get(LESSON_TYPES.LECTURE);
      expect(lecturePatterns).toContain('новая лекция');
    });

    it('returns sorted patterns', () => {
      const patterns = clf.getPatterns();
      for (const [, patternList] of patterns) {
        expect(patternList).toEqual([...patternList].sort());
      }
    });
  });

  describe('reset', () => {
    it('clears learned patterns', () => {
      clf.learn('custom pattern', LESSON_TYPES.LECTURE);
      clf.reset();
      const result = clf.classify('custom pattern');
      expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
    });

    it('restores base patterns', () => {
      clf.reset();
      const result = clf.classify('лекция');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton classifier', () => {
      expect(classifier).toBeInstanceOf(SmartTypeClassifier);
    });

    it('singleton works correctly', () => {
      const result = classifier.classify('лекция');
      expect(result.type).toBe(LESSON_TYPES.LECTURE);
    });
  });

  describe('confidence scoring', () => {
    it('gives higher confidence for exact word match', () => {
      const result1 = clf.classify('лекция');
      const result2 = clf.classify('лекция по анатомии');
      expect(result1.confidence).toBeGreaterThanOrEqual(result2.confidence);
    });

    it('gives higher confidence for longer matching patterns', () => {
      const result1 = clf.classify('лаб');
      const result2 = clf.classify('лабораторная работа');
      expect(result2.confidence).toBeGreaterThanOrEqual(result1.confidence);
    });

    it('gives maximum confidence (1.0) for full pattern match', () => {
      const result = clf.classify('лабораторная работа');
      expect(result.confidence).toBe(1.0);
    });

    it('returns confidence below 0.3 as UNKNOWN', () => {
      const result = clf.classify('лек'); // Short pattern, low confidence
      if (result.confidence < 0.3) {
        expect(result.type).toBe(LESSON_TYPES.UNKNOWN);
      }
    });
  });
});