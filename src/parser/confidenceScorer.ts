/**
 * ConfidenceScorer - вычисляет confidence score для каждого урока
 * на основе качества извлеченных полей
 */

import { TYPE_IDS } from '../constants.js';

export interface ConfidenceFactors {
  /** Есть ли предмет */
  hasSubject: boolean;
  /** Есть ли тип занятия */
  hasType: boolean;
  /** Есть ли комната */
  hasRoom: boolean;
  /** Есть ли преподаватель */
  hasTeacher: boolean;
  /** Тип распознан с высокой уверенностью */
  typeConfidence: number;
  /** Предмет не пустой после очистки */
  subjectQuality: number;
  /** Комната выглядит валидно */
  roomQuality: number;
  /** Преподаватель выглядит валидно */
  teacherQuality: number;
  /** Ячейка не была пустой */
  cellNotEmpty: boolean;
  /** День недели распознан */
  dayRecognized: boolean;
  /** Время/пара распознаны */
  timeRecognized: boolean;
  /** Группа распознана */
  groupRecognized: boolean;
}

export interface ConfidenceResult {
  /** Итоговый confidence score (0-1) */
  score: number;
  /** Факторы, повлиявшие на score */
  factors: ConfidenceFactors;
  /** Предупреждения для низких полей */
  warnings: string[];
}

/**
 * Веса для каждого фактора (сумма = 1.0)
 */
const WEIGHTS = {
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
} as const;

/**
 * Пороги для предупреждений
 */
const WARNING_THRESHOLDS = {
  subjectQuality: 0.5,
  roomQuality: 0.8,
  teacherQuality: 0.5,
  typeConfidence: 0.4,
} as const;

/**
 * Оценивает качество предмета (0-1)
 */
function scoreSubjectQuality(subject: string): number {
  if (!subject || subject.trim().length === 0) return 0;
  const trimmed = subject.trim();
  // Слишком короткий
  if (trimmed.length < 3) return 0.3;
  // Содержит только цифры/спецсимволы
  if (/^[\d\s.,;:№\-]+$/.test(trimmed)) return 0.2;
  // Нормальный предмет
  if (trimmed.length > 10) return 1.0;
  return 0.7;
}

/**
 * Оценивает качество комнаты (0-1)
 */
function scoreRoomQuality(room: string): number {
  if (!room || room.trim().length === 0) return 0;
  const trimmed = room.trim();
  // Известные типы комнат с полным качеством (даже без номера)
  if (/спорттук|аянтча|Оптика/i.test(trimmed)) return 1.0;
  // Есть номер корпуса/аудитории
  if (/\d/.test(trimmed) && /(корп|корпус|ауд|№)/i.test(trimmed)) return 1.0;
  // Только цифры
  if (/^\d+$/.test(trimmed)) return 0.5;
  // Есть текст
  return 0.7;
}

/**
 * Оценивает качество преподавателя (0-1)
 */
function scoreTeacherQuality(teacher: string): number {
  if (!teacher || teacher.trim().length === 0) return 0;
  const trimmed = teacher.trim();
  // Формат "Фамилия И.О." или "Фамилия И.О. кызы/уулу"
  if (/^[А-ЯӨҢҮ][а-яёөңү]+(?:\s+[а-яёөңү]+)*\s+[А-ЯӨҢҮ](?:\.[А-ЯӨҢҮ])?\.?(?:\s+(?:кызы|уулу))?$/i.test(trimmed)) {
    return 1.0;
  }
  // Есть инициалы (Фамилия И. И. или Фамилия И.И.)
  if (/[А-ЯӨҢҮ]\.\s*[А-ЯӨҢҮ]\.?/.test(trimmed)) return 0.8;
  // Есть фамилия и имя
  if (trimmed.split(/\s+/).length >= 2) return 0.6;
  return 0.3;
}

/**
 * Создает ConfidenceScorer
 */
export function createConfidenceScorer() {
  /**
   * Вычисляет confidence для урока
   */
  function scoreLesson(lesson: {
    subject: string;
    type: string;
    room: string;
    teacher: string;
    isExam: boolean;
    rawTypeConfidence: number;
    day: string;
    time: string;
    para: string;
    group: string;
    subgroup?: string;
  }): ConfidenceResult {
    const factors: ConfidenceFactors = {
      hasSubject: Boolean(lesson.subject && lesson.subject.trim().length > 0),
      hasType: Boolean(lesson.type && lesson.type !== TYPE_IDS.OTHER),
      hasRoom: Boolean(lesson.room && lesson.room.trim().length > 0),
      hasTeacher: Boolean(lesson.teacher && lesson.teacher.trim().length > 0),
      typeConfidence: lesson.rawTypeConfidence || 0,
      subjectQuality: scoreSubjectQuality(lesson.subject),
      roomQuality: scoreRoomQuality(lesson.room),
      teacherQuality: scoreTeacherQuality(lesson.teacher),
      cellNotEmpty: Boolean(lesson.subject || lesson.room || lesson.teacher),
      dayRecognized: Boolean(lesson.day && lesson.day.trim().length > 0),
      timeRecognized: Boolean((lesson.time && lesson.time.trim().length > 0) || (lesson.para && lesson.para.trim().length > 0)),
      groupRecognized: Boolean(lesson.group && lesson.group.trim().length > 0),
    };

    // Вычисляем взвешенную сумму
    let score = 0;
    for (const [key, weight] of Object.entries(WEIGHTS)) {
      const factorKey = key as keyof ConfidenceFactors;
      const value = factors[factorKey];
      if (typeof value === 'boolean') {
        score += (value ? 1 : 0) * weight;
      } else if (typeof value === 'number') {
        score += value * weight;
      }
    }

    // Округляем до 2 знаков
    score = Math.round(score * 100) / 100;

    // Генерируем предупреждения
    const warnings: string[] = [];
    if (factors.subjectQuality < WARNING_THRESHOLDS.subjectQuality) {
      warnings.push('Низкое качество названия предмета');
    }
    if (factors.roomQuality < WARNING_THRESHOLDS.roomQuality && factors.hasRoom) {
      warnings.push('Комната выглядит некорректно');
    }
    if (factors.teacherQuality < WARNING_THRESHOLDS.teacherQuality && factors.hasTeacher) {
      warnings.push('Преподаватель выглядит некорректно');
    }
    if (factors.typeConfidence < WARNING_THRESHOLDS.typeConfidence) {
      warnings.push('Тип занятия не определен точно');
    }
    if (!factors.dayRecognized) {
      warnings.push('День недели не распознан');
    }
    if (!factors.timeRecognized) {
      warnings.push('Время/пара не распознаны');
    }
    if (!factors.groupRecognized) {
      warnings.push('Группа не распознана');
    }

    return { score, factors, warnings };
  }

  return { scoreLesson };
}

/**
 * Singleton instance
 */
export const confidenceScorer = createConfidenceScorer();