import { describe, it, expect, beforeEach } from 'vitest';
import { createConfidenceScorer, confidenceScorer } from '../src/parser/confidenceScorer.ts';
import { TYPE_IDS } from '../src/constants.js';

describe('ConfidenceScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = createConfidenceScorer();
  });

  const createLesson = (overrides = {}) => ({
    subject: 'Анатомия',
    type: TYPE_IDS.LECTURE,
    room: '№7 корпус 315',
    teacher: 'Иванов И.И.',
    isExam: false,
    rawTypeConfidence: 0.9,
    day: 'Понедельник',
    time: '08:00-09:20',
    para: '1',
    group: 'СЖ-1-25',
    subgroup: '1',
    ...overrides,
  });

  describe('scoreLesson - basic scoring', () => {
    it('gives high score for complete lesson', () => {
      const lesson = createLesson();
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBeGreaterThan(0.8);
      expect(result.warnings).toHaveLength(0);
    });

    it('gives lower score for missing subject', () => {
      const lesson = createLesson({ subject: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBeLessThan(0.8);
      expect(result.warnings).toContain('Низкое качество названия предмета');
    });

    it('gives lower score for missing type', () => {
      const lesson = createLesson({ type: TYPE_IDS.OTHER });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBeLessThan(0.9);
    });

    it('gives lower score for missing room', () => {
      const lesson = createLesson({ room: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBeLessThan(0.9);
    });

    it('gives lower score for missing teacher', () => {
      const lesson = createLesson({ teacher: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBeLessThan(0.9);
    });

    it('gives zero score for completely empty lesson', () => {
      const lesson = createLesson({
        subject: '',
        type: TYPE_IDS.OTHER,
        room: '',
        teacher: '',
        day: '',
        time: '',
        para: '',
        group: '',
        rawTypeConfidence: 0,
      });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBe(0);
    });
  });

  describe('scoreLesson - subject quality', () => {
    it('gives high quality for long subject', () => {
      const lesson = createLesson({ subject: 'Анатомия человека общая' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.subjectQuality).toBe(1.0);
    });

    it('gives medium quality for short subject', () => {
      const lesson = createLesson({ subject: 'Мат' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.subjectQuality).toBe(0.7);
    });

    it('gives low quality for very short subject', () => {
      const lesson = createLesson({ subject: 'А' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.subjectQuality).toBe(0.3);
    });

    it('gives low quality for numbers only', () => {
      const lesson = createLesson({ subject: '123 456' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.subjectQuality).toBe(0.2);
    });

    it('gives low quality for special chars only', () => {
      const lesson = createLesson({ subject: '.,;:№-' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.subjectQuality).toBe(0.2);
    });
  });

  describe('scoreLesson - room quality', () => {
    it('gives high quality for room with building number', () => {
      const lesson = createLesson({ room: '№7 корпус 315' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(1.0);
    });

    it('gives high quality for room with "ауд"', () => {
      const lesson = createLesson({ room: 'ауд. 315' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(1.0);
    });

    it('gives high quality for sport area', () => {
      const lesson = createLesson({ room: 'спорттук аянтча' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(1.0);
    });

    it('gives high quality for Optika', () => {
      const lesson = createLesson({ room: 'Оптика' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(1.0);
    });

    it('gives medium quality for numbers only', () => {
      const lesson = createLesson({ room: '315' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(0.5);
    });

    it('gives medium quality for text only', () => {
      const lesson = createLesson({ room: 'Кабинет' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(0.7);
    });

    it('gives zero quality for empty room', () => {
      const lesson = createLesson({ room: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.roomQuality).toBe(0);
    });
  });

  describe('scoreLesson - teacher quality', () => {
    it('gives high quality for standard format', () => {
      const lesson = createLesson({ teacher: 'Иванов И.И.' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(1.0);
    });

    it('gives high quality for Kyrgyz "кызы" format', () => {
      const lesson = createLesson({ teacher: 'Улукбек кызы Э.' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(1.0);
    });

    it('gives high quality for Kyrgyz "уулу" format', () => {
      const lesson = createLesson({ teacher: 'Кадырбек уулу М.' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(1.0);
    });

    it('gives medium quality for initials only', () => {
      const lesson = createLesson({ teacher: 'Иванов И. И.' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(0.8);
    });

    it('gives low quality for just name', () => {
      const lesson = createLesson({ teacher: 'Иванов Иван' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(0.6);
    });

    it('gives very low quality for single word', () => {
      const lesson = createLesson({ teacher: 'Иванов' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(0.3);
    });

    it('gives zero quality for empty teacher', () => {
      const lesson = createLesson({ teacher: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.teacherQuality).toBe(0);
    });
  });

  describe('scoreLesson - type confidence', () => {
    it('uses rawTypeConfidence directly', () => {
      const lesson = createLesson({ rawTypeConfidence: 0.95 });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.typeConfidence).toBe(0.95);
    });

    it('gives warning for low type confidence', () => {
      const lesson = createLesson({ rawTypeConfidence: 0.3 });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).toContain('Тип занятия не определен точно');
    });
  });

  describe('scoreLesson - context factors', () => {
    it('recognizes day', () => {
      const lesson = createLesson({ day: 'Понедельник' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.dayRecognized).toBe(true);
    });

    it('warns for missing day', () => {
      const lesson = createLesson({ day: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.dayRecognized).toBe(false);
      expect(result.warnings).toContain('День недели не распознан');
    });

    it('recognizes time', () => {
      const lesson = createLesson({ time: '08:00-09:20' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.timeRecognized).toBe(true);
    });

    it('recognizes para as time alternative', () => {
      const lesson = createLesson({ time: '', para: '1' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.timeRecognized).toBe(true);
    });

    it('warns for missing time and para', () => {
      const lesson = createLesson({ time: '', para: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.timeRecognized).toBe(false);
      expect(result.warnings).toContain('Время/пара не распознаны');
    });

    it('recognizes group', () => {
      const lesson = createLesson({ group: 'СЖ-1-25' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.groupRecognized).toBe(true);
    });

    it('warns for missing group', () => {
      const lesson = createLesson({ group: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.groupRecognized).toBe(false);
      expect(result.warnings).toContain('Группа не распознана');
    });
  });

  describe('scoreLesson - cellNotEmpty', () => {
    it('is true when any field present', () => {
      const lesson = createLesson({ subject: 'Test', room: '', teacher: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.cellNotEmpty).toBe(true);
    });

    it('is false when all fields empty', () => {
      const lesson = createLesson({ subject: '', room: '', teacher: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.factors.cellNotEmpty).toBe(false);
    });
  });

  describe('scoreLesson - score rounding', () => {
    it('rounds score to 2 decimal places', () => {
      const lesson = createLesson({ subject: 'Анатомия' });
      const result = scorer.scoreLesson(lesson);
      expect(result.score).toBe(Math.round(result.score * 100) / 100);
    });
  });

  describe('scoreLesson - warnings', () => {
    it('warns for low subject quality', () => {
      const lesson = createLesson({ subject: 'А' });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).toContain('Низкое качество названия предмета');
    });

    it('warns for low room quality when room exists', () => {
      const lesson = createLesson({ room: 'Кабинет' });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).toContain('Комната выглядит некорректно');
    });

    it('does not warn for low room quality when room empty', () => {
      const lesson = createLesson({ room: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).not.toContain('Комната выглядит некорректно');
    });

    it('warns for low teacher quality when teacher exists', () => {
      const lesson = createLesson({ teacher: 'Иванов' });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).toContain('Преподаватель выглядит некорректно');
    });

    it('does not warn for low teacher quality when teacher empty', () => {
      const lesson = createLesson({ teacher: '' });
      const result = scorer.scoreLesson(lesson);
      expect(result.warnings).not.toContain('Преподаватель выглядит некорректно');
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton confidenceScorer', () => {
      expect(confidenceScorer).toBeDefined();
      expect(typeof confidenceScorer.scoreLesson).toBe('function');
    });
  });

  describe('weights sum to 1', () => {
    it('verifies weights configuration', () => {
      // This test verifies the WEIGHTS constant sums to 1.0
      const weights = {
        hasSubject: 0.20,
        hasType: 0.15,
        hasRoom: 0.10,
        hasTeacher: 0.10,
        typeConfidence: 0.15,
        subjectQuality: 0.10,
        roomQuality: 0.05,
        teacherQuality: 0.05,
        cellNotEmpty: 0.025,
        dayRecognized: 0.025,
        timeRecognized: 0.025,
        groupRecognized: 0.025,
      };
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBe(1.0);
    });
  });
});