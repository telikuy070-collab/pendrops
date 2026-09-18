import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFieldExtractor, fieldExtractor, resetFieldExtractor } from '../src/parser/fieldExtractor.ts';
import { LESSON_TYPES } from '../src/parser/classifier.ts';
import { TYPE_IDS } from '../src/constants.js';

describe('FieldExtractor', () => {
  let extractor;

  beforeEach(() => {
    resetFieldExtractor();
    extractor = createFieldExtractor();
  });

  describe('extractRoom', () => {
    it('extracts "№7 корп. 345" format', () => {
      const result = extractor.extractRoom('Анатомия лекция №7 корп. 345 Иванов И.И.');
      expect(result).not.toBeNull();
      expect(result.value).toContain('№7');
      expect(result.value).toContain('корп');
      expect(result.confidence).toBe(0.95);
    });

    it('extracts "спорттук аянтча" format', () => {
      const result = extractor.extractRoom('Дене тарбия пр., спорттук аянтча Токтобаев А.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('спорттук аянтча');
      expect(result.confidence).toBe(0.9);
    });

    it('extracts "кл. каб 345" format', () => {
      const result = extractor.extractRoom('Химия лаб. кл. каб 345 Петров П.');
      expect(result).not.toBeNull();
      expect(result.value).toContain('кл. каб');
      expect(result.confidence).toBe(0.85);
    });

    it('extracts "ауд. 345" format', () => {
      const result = extractor.extractRoom('Физика пр. ауд. 345 Сидоров С.');
      expect(result).not.toBeNull();
      expect(result.value).toContain('ауд');
      expect(result.confidence).toBe(0.85);
    });

    it('extracts "ауд 345" format (without dot)', () => {
      const result = extractor.extractRoom('Математика лекция ауд 345');
      expect(result).not.toBeNull();
      expect(result.value).toContain('ауд');
    });

    it('returns null for text without room', () => {
      const result = extractor.extractRoom('Анатомия лекция Иванов И.И.');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractor.extractRoom('')).toBeNull();
      expect(extractor.extractRoom('   ')).toBeNull();
    });

    it('handles case insensitivity', () => {
      const result = extractor.extractRoom('АНАТОМИЯ ЛЕКЦИЯ №7 КОРП. 345');
      expect(result).not.toBeNull();
      expect(result.value).toContain('№7');
    });
  });

  describe('extractTeacher', () => {
    it('extracts standard "Фамилия И.О." format', () => {
      const result = extractor.extractTeacher('Анатомия лекция №7 корпус 315 Иванов И.И.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Иванов И.И.');
      expect(result.confidence).toBe(0.95);
    });

    it('extracts "Фамилия И. О." format with spaces', () => {
      const result = extractor.extractTeacher('Химия пр. №7 320 Петров П. П.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Петров П. П.');
    });

    it('extracts Kyrgyz "кызы" format', () => {
      const result = extractor.extractTeacher('Фармацевтикалык химия 2 лекция №7 корпус 315 Улукбек кызы Э.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Улукбек кызы Э.');
      expect(result.confidence).toBe(0.9);
    });

    it('extracts Kyrgyz "уулу" format', () => {
      const result = extractor.extractTeacher('Дене тарбия пр., спорттук аянтча Кадырбек уулу М.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Кадырбек уулу М.');
      expect(result.confidence).toBe(0.9);
    });

    it('picks last teacher when multiple present', () => {
      const result = extractor.extractTeacher('Иванов И.И. Петров П.П. Сидоров С.С.');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Сидоров С.С.');
    });

    it('returns null for text without teacher', () => {
      const result = extractor.extractTeacher('Анатомия лекция №7 корпус 315');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractor.extractTeacher('')).toBeNull();
      expect(extractor.extractTeacher('   ')).toBeNull();
    });

    it('validates teacher format - rejects too long', () => {
      const result = extractor.extractTeacher('ОченьДлиннаяФамилия И.И. И.И. И.И. И.И. И.И.');
      expect(result).toBeNull();
    });

    it('validates teacher format - rejects short first word', () => {
      const result = extractor.extractTeacher('А И.И.');
      expect(result).toBeNull();
    });
  });

  describe('extractType', () => {
    it('extracts lecture type', () => {
      const result = extractor.extractType('Анатомия лекция');
      expect(result).not.toBeNull();
      expect(result.value).toBe(TYPE_IDS.LECTURE);
    });

    it('extracts practice type', () => {
      const result = extractor.extractType('Фармакология практика');
      expect(result).not.toBeNull();
      expect(result.value).toBe(TYPE_IDS.PRACTICE);
    });

    it('extracts lab type', () => {
      const result = extractor.extractType('Химия лабораторная');
      expect(result).not.toBeNull();
      expect(result.value).toBe(TYPE_IDS.LAB);
    });

    it('extracts exam/other type', () => {
      const result = extractor.extractType('Математика экзамен');
      expect(result).not.toBeNull();
      expect(result.value).toBe(TYPE_IDS.OTHER);
    });

    it('returns null for unknown type', () => {
      const result = extractor.extractType('Странный текст без типа');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractor.extractType('')).toBeNull();
    });
  });

  describe('extractSubject', () => {
    it('extracts subject after removing room and teacher', () => {
      const room = { value: '№7 корпус 315', confidence: 0.95 };
      const teacher = { value: 'Иванов И.И.', confidence: 0.95 };
      const result = extractor.extractSubject('Анатомия лекция №7 корпус 315 Иванов И.И.', { room, teacher });
      expect(result.value).toContain('Анатомия');
      expect(result.value).not.toContain('№7');
      expect(result.value).not.toContain('Иванов');
    });

    it('removes type keywords from beginning', () => {
      const result = extractor.extractSubject('лекция Анатомия', { room: null, teacher: null });
      expect(result.value).toBe('Анатомия');
    });

    it('removes "лабораторная" keyword', () => {
      const result = extractor.extractSubject('лабораторная Химия', { room: null, teacher: null });
      expect(result.value).toBe('Химия');
    });

    it('removes "практика" keyword', () => {
      const result = extractor.extractSubject('практика Физика', { room: null, teacher: null });
      expect(result.value).toBe('Физика');
    });

    it('returns original text if nothing extracted', () => {
      const result = extractor.extractSubject('Просто текст', { room: null, teacher: null, type: null });
      expect(result.value).toBe('Просто текст');
    });

    it('returns empty for empty string', () => {
      const result = extractor.extractSubject('', { room: null, teacher: null });
      expect(result.value).toBe('');
      expect(result.confidence).toBe(0);
    });

    it('gives higher confidence when more fields extracted', () => {
      const room = { value: 'ауд 315', confidence: 0.85 };
      const teacher = { value: 'Иванов И.И.', confidence: 0.95 };
      const type = { value: TYPE_IDS.LECTURE, confidence: 0.9 };

      const result1 = extractor.extractSubject('Анатомия', { room: null, teacher: null, type: null });
      const result2 = extractor.extractSubject('Анатомия ауд 315 Иванов И.И.', { room, teacher, type });

      expect(result2.confidence).toBeGreaterThan(result1.confidence);
    });
  });

  describe('extractAll', () => {
    it('extracts all fields from complete cell', () => {
      const result = extractor.extractAll('Анатомия лекция №7 корпус 315 Иванов И.И.');
      expect(result.subject.value).toContain('Анатомия');
      expect(result.type.value).toBe(TYPE_IDS.LECTURE);
      expect(result.room.value).toContain('№7');
      expect(result.teacher.value).toBe('Иванов И.И.');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('handles kurator hour specially', () => {
      const result = extractor.extractAll('Куратордук саат');
      expect(result.type.value).toBe(TYPE_IDS.OTHER);
      expect(result.subject.value).toBe('Кураторский час');
      expect(result.confidence).toBe(1.0);
    });

    it('handles kurator hour in Russian', () => {
      const result = extractor.extractAll('Кураторский час');
      expect(result.type.value).toBe(TYPE_IDS.OTHER);
      expect(result.subject.value).toBe('Кураторский час');
      expect(result.confidence).toBe(1.0);
    });

    it('handles sport area as room', () => {
      const result = extractor.extractAll('Дене тарбия пр., спорттук аянтча Токтобаев А.');
      expect(result.room.value).toBe('спорттук аянтча');
      expect(result.teacher.value).toBe('Токтобаев А.');
      expect(result.type.value).toBe(TYPE_IDS.PRACTICE);
    });

    it('handles Optika room', () => {
      const result = extractor.extractAll('Клиникалык патология пр. Оптика Г. Айтиев Урбай кызы Н.');
      expect(result.room.value).toBe('Оптика');
      expect(result.teacher.value).toBe('Айтиев Урбай кызы Н.');
    });

    it('returns empty structure for empty string', () => {
      const result = extractor.extractAll('');
      expect(result.subject.value).toBe('');
      expect(result.type).toBeNull();
      expect(result.room).toBeNull();
      expect(result.teacher).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('handles cell with only subject', () => {
      const result = extractor.extractAll('Анатомия');
      expect(result.subject.value).toBe('Анатомия');
      expect(result.type).toBeNull();
      expect(result.room).toBeNull();
      expect(result.teacher).toBeNull();
    });

    it('handles cell with subject and room only', () => {
      const result = extractor.extractAll('Анатомия ауд. 315');
      expect(result.subject.value).toContain('Анатомия');
      expect(result.room.value).toContain('ауд');
      expect(result.type).toBeNull();
      expect(result.teacher).toBeNull();
    });
  });

  describe('custom config', () => {
    it('accepts custom room pattern', () => {
      const customExtractor = createFieldExtractor({
        roomPattern: /кабинет\s+\d+/i,
      });
      const result = customExtractor.extractRoom('Анатомия кабинет 315');
      expect(result).not.toBeNull();
      expect(result.value).toBe('кабинет 315');
    });

    it('accepts custom teacher pattern', () => {
      const customExtractor = createFieldExtractor({
        teacherPattern: /Dr\.\s+[A-Z][a-z]+/,
      });
      const result = customExtractor.extractTeacher('Biology Dr. Smith');
      expect(result).not.toBeNull();
      expect(result.value).toBe('Dr. Smith');
    });

    it('learns custom type patterns', () => {
      const customExtractor = createFieldExtractor({
        typePatterns: {
          'tp-lecture': ['custom lecture keyword'],
        },
      });
      const result = customExtractor.extractType('custom lecture keyword Biology');
      expect(result).not.toBeNull();
      expect(result.value).toBe(TYPE_IDS.LECTURE);
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton fieldExtractor', () => {
      expect(fieldExtractor).toBeDefined();
      expect(typeof fieldExtractor.extractAll).toBe('function');
    });
  });
});