/**
 * Smart Type Classifier - умный классификатор типов занятий
 * с fuzzy matching и обучением на новых вариациях
 */

export interface ClassificationResult {
  type: string;
  confidence: number;
}

export interface TypeClassifier {
  classify(text: string): ClassificationResult;
  learn(text: string, correctType: string): void;
  getPatterns(): Map<string, string[]>;
}

/**
 * Интерфейс для коррекции пользователем
 */
export interface LessonCorrection {
  /** ID урока (если есть) */
  lessonId?: string;
  /** Исходный сырой текст ячейки */
  rawText: string;
  /** Исправленные поля */
  correctedFields: {
    type?: string;
    subject?: string;
    teacher?: string;
    room?: string;
  };
  /** Контекст (день, время, группа) */
  context?: {
    day?: string;
    time?: string;
    group?: string;
  };
}

// Типы занятий (совпадают с TYPE_IDS из constants.js)
export const LESSON_TYPES = {
  LECTURE: 'tp-lecture',
  PRACTICE: 'tp-practice',
  LAB: 'tp-lab',
  OTHER: 'tp-other',
  UNKNOWN: 'unknown',
} as const;

export type LessonType = (typeof LESSON_TYPES)[keyof typeof LESSON_TYPES];

// Базовые паттерны для каждого типа (ключевые подстроки)
const BASE_PATTERNS: Record<LessonType, string[]> = {
  [LESSON_TYPES.LECTURE]: [
    'лек',
    'лекц',
    'лекция',
    'лекции',
    'лекц.',
    'lecture',
    'lect',
  ],
  [LESSON_TYPES.PRACTICE]: [
    'пр',
    'практ',
    'практика',
    'практикум',
    'семинар',
    'сем',
  ],
  [LESSON_TYPES.LAB]: [
    'лаб',
    'лабораторн',
    'lab',
  ],
  [LESSON_TYPES.OTHER]: [
    'экзамен',
    'экз',
    'зачёт',
    'зачет',
    'зач',
    'тест',
    'контрольн',
    'кр',
    'коллоквиум',
    'диф.зачёт',
    'диф.зачет',
    'куратор',
    'куратордук',
  ],
  [LESSON_TYPES.UNKNOWN]: [],
};

// Нормализация текста для сравнения
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ');
}

// Вычисление confidence на основе совпадения
function calculateConfidence(text: string, patterns: string[]): number {
  const normalized = normalize(text);
  let maxScore = 0;

  for (const pattern of patterns) {
    const normPattern = normalize(pattern);
    if (normPattern.length === 0) continue;

    // Точное совпадение слова
    const wordRegex = new RegExp(`(^|\\s)${escapeRegExp(normPattern)}(\\s|$)`);
    if (wordRegex.test(normalized)) {
      // Для точного совпадения слова даем высокий confidence, но учитываем длину паттерна
      const patternLengthBonus = Math.min(normPattern.length / 10, 0.1);
      maxScore = Math.max(maxScore, 0.9 + patternLengthBonus);
      continue;
    }

    // Совпадение подстроки
    if (normalized.includes(normPattern)) {
      // Чем длиннее паттерн и чем больше его доля в тексте, тем выше confidence
      const ratio = normPattern.length / normalized.length;
      const patternLengthBonus = Math.min(normPattern.length / 15, 0.25);
      const score = 0.7 + ratio * 0.25 + patternLengthBonus; // 0.7 - 1.0
      maxScore = Math.max(maxScore, Math.min(score, 1.0));
    }
  }

  return maxScore;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class SmartTypeClassifier implements TypeClassifier {
  private patterns: Map<LessonType, Set<string>>;
  private learnedPatterns: Map<string, LessonType>; // запомненные вариации -> тип

  constructor() {
    this.patterns = new Map();
    this.learnedPatterns = new Map();

    // Инициализация базовыми паттернами
    for (const [type, patterns] of Object.entries(BASE_PATTERNS)) {
      this.patterns.set(type as LessonType, new Set(patterns));
    }
  }

  /**
   * Классифицирует текст и возвращает тип с confidence
   */
  classify(text: string): ClassificationResult {
    if (!text || typeof text !== 'string') {
      return { type: LESSON_TYPES.UNKNOWN, confidence: 0 };
    }

    const normalized = normalize(text);

    // Сначала проверяем выученные паттерны (приоритет)
    for (const [learnedPattern, type] of this.learnedPatterns) {
      const normLearned = normalize(learnedPattern);
      if (normalized.includes(normLearned)) {
        return { type, confidence: 0.98 };
      }
    }

    // Затем проверяем базовые паттерны
    let bestType: LessonType = LESSON_TYPES.UNKNOWN;
    let bestConfidence = 0;

    for (const [type, patternSet] of this.patterns) {
      if (type === LESSON_TYPES.UNKNOWN) continue;

      const confidence = calculateConfidence(text, Array.from(patternSet));
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestType = type;
      }
    }

    // Порог для UNKNOWN
    if (bestConfidence < 0.3) {
      return { type: LESSON_TYPES.UNKNOWN, confidence: 0 };
    }

    return { type: bestType, confidence: bestConfidence };
  }

  /**
   * Обучает классификатор новой вариации
   */
  learn(text: string, correctType: string): void {
    if (!text || !correctType) return;

    const normalized = normalize(text);
    const type = correctType as LessonType;

    // Проверяем, что тип валидный
    if (!Object.values(LESSON_TYPES).includes(type)) {
      console.warn(`[SmartTypeClassifier] Unknown type: ${correctType}`);
      return;
    }

    // Добавляем в выученные паттерны
    this.learnedPatterns.set(normalized, type);

    // Также добавляем в основные паттерны для будущего использования
    const patternSet = this.patterns.get(type);
    if (patternSet) {
      patternSet.add(normalized);
    }
  }

  /**
   * Возвращает все паттерны (базовые + выученные)
   */
  getPatterns(): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [type, patternSet] of this.patterns) {
      result.set(type, Array.from(patternSet).sort());
    }

    // Добавляем выученные как отдельную категорию
    const learnedMap = new Map<LessonType, string[]>();
    for (const [pattern, type] of this.learnedPatterns) {
      if (!learnedMap.has(type)) {
        learnedMap.set(type, []);
      }
      learnedMap.get(type)!.push(pattern);
    }

    for (const [type, patterns] of learnedMap) {
      const existing = result.get(type) || [];
      result.set(type, [...new Set([...existing, ...patterns])].sort());
    }

    return result;
  }

  /**
   * Сбрасывает выученные паттерны к базовым
   */
  reset(): void {
    this.learnedPatterns.clear();
    this.patterns.clear();
    for (const [type, patterns] of Object.entries(BASE_PATTERNS)) {
      this.patterns.set(type as LessonType, new Set(patterns));
    }
  }
}

// Экспорт singleton instance для удобства
export const classifier = new SmartTypeClassifier();

/**
 * Применяет коррекцию пользователя для обучения классификатора и экстрактора
 * @param correction - объект с исходным текстом и исправленными полями
 */
export function applyCorrection(correction: LessonCorrection): void {
  const { rawText, correctedFields } = correction;

  if (!rawText || !correctedFields) {
    console.warn('[applyCorrection] Missing rawText or correctedFields');
    return;
  }

  const normalized = normalize(rawText);

  // 1. Обучаем классификатор типу, если он был исправлен
  if (correctedFields.type) {
    classifier.learn(normalized, correctedFields.type);
  }

  // 2. Если предмет был исправлен, можем выучить паттерны для subject extraction
  // (пока просто логируем, в будущем можно расширить fieldExtractor)
  if (correctedFields.subject) {
    // Можно добавить обучение для subject extraction здесь
    console.debug('[applyCorrection] Subject corrected:', {
      raw: normalized,
      corrected: correctedFields.subject,
    });
  }

  // 3. Логируем для анализа
  console.info('[applyCorrection] Applied correction:', {
    rawText: normalized,
    correctedFields,
    context: correction.context,
  });
}

/**
 * Массовое применение коррекций (например, из экспортированных данных)
 */
export function applyCorrections(corrections: LessonCorrection[]): void {
  for (const correction of corrections) {
    applyCorrection(correction);
  }
}

/**
 * Экспортирует выученные паттерны для сохранения/переноса
 */
export function exportLearnedPatterns(): {
  classifierPatterns: Map<string, string[]>;
  timestamp: number;
} {
  return {
    classifierPatterns: classifier.getPatterns(),
    timestamp: Date.now(),
  };
}

/**
 * Импортирует выученные паттерны
 */
export function importLearnedPatterns(data: { classifierPatterns: Map<string, string[]> }): void {
  if (data.classifierPatterns) {
    // Сбрасываем и применяем импортированные паттерны
    classifier.reset();
    for (const [type, patterns] of data.classifierPatterns) {
      for (const pattern of patterns) {
        classifier.learn(pattern, type);
      }
    }
  }
}

export { classifier as default };