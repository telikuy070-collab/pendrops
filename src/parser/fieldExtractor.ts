/**
 * Semantic Field Extractor - семантическое извлечение полей из текста ячейки
 * Вместо позиционного парсинга ("колонка 3 = время") понимает смысл по содержимому.
 */

import { norm } from '../text.js';
import { classifier, LESSON_TYPES, type ClassificationResult } from './classifier.js';
import { TYPE_IDS } from '../constants.js';

/**
 * Результат извлечения поля с confidence score
 */
export interface ExtractedField {
  value: string;
  confidence: number;
}

/**
 * Результат полного извлечения всех полей
 */
export interface ExtractedAllFields {
  type: ExtractedField | null;
  room: ExtractedField | null;
  teacher: ExtractedField | null;
  subject: ExtractedField;
  confidence: number; // общий confidence (минимум из ненулевых полей)
}

/**
 * Конфигурация экстрактора
 */
export interface FieldExtractorConfig {
  /** Паттерн для аудитории */
  roomPattern?: RegExp;
  /** Паттерн для преподавателя */
  teacherPattern?: RegExp;
  /** Паттерн для типа занятия (для обучения классификатора) */
  typePatterns?: Record<string, string[]>;
  /** Паттерн для кураторских часов */
  kuratorPattern?: RegExp;
  /** Паттерн для экзаменов */
  examPattern?: RegExp;
}

// Базовые паттерны согласно требованиям
const DEFAULT_ROOM_PATTERN = /(?:№\d+\s*корп(?:ус)?\.?,?\s*\d+|спорттук\s+аянтча|кл\.\s*каб\s*\d+|ауд\.?\s*\d+|ауд\s+\d+|Оптика)/i;

// Улучшенный паттерн для стандартного ФИО: поддерживает "И.И.", "И. И.", "И И" форматы (макс 2 инициала)
// Используем negative lookbehind вместо \b, так как \b не работает с кириллицей
const DEFAULT_TEACHER_PATTERN = /(?<![А-ЯЁа-яё])[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.?(?:\s*[А-ЯЁ]\.?){0,2}/;

const DEFAULT_KURATOR_PATTERN = /куратордук|куратор/i;

const DEFAULT_EXAM_PATTERN = /(?:^|[\s.,;:])(экзамен|экз\.?|зачёт|зачет|зач\.?|тест|диф\.\s*зачёт|диф\.\s*зачет|контрольн[а-я]*|к\.\s*р\.?|кр|коллоквиум)(?=$|[\s.,;:,.])/i;

/**
 * Маппинг типов классификатора на TYPE_IDS
 */
function mapClassifierTypeToTypeId(classifierType: string): string {
  switch (classifierType) {
    case 'tp-lecture':
      return TYPE_IDS.LECTURE;
    case 'tp-practice':
      return TYPE_IDS.PRACTICE;
    case 'tp-lab':
      return TYPE_IDS.LAB;
    case 'tp-other':
      return TYPE_IDS.OTHER;
    default:
      return TYPE_IDS.OTHER;
  }
}

/**
 * Вычисляет общий confidence на основе извлеченных полей
 */
function calculateOverallConfidence(fields: {
  type: ExtractedField | null;
  room: ExtractedField | null;
  teacher: ExtractedField | null;
  subject: ExtractedField;
}): number {
  const confidences = [
    fields.type?.confidence ?? 1,
    fields.room?.confidence ?? 1,
    fields.teacher?.confidence ?? 1,
    fields.subject.confidence,
  ].filter((c) => c > 0);

  if (confidences.length === 0) return 0;
  // Общий confidence = минимум из ненулевых (слабое звено)
  return Math.min(...confidences);
}

/**
 * Создает экземпляр FieldExtractor с заданной конфигурацией
 */
export function createFieldExtractor(config: FieldExtractorConfig = {}) {
  const roomPattern = config.roomPattern || DEFAULT_ROOM_PATTERN;
  const teacherPattern = config.teacherPattern || DEFAULT_TEACHER_PATTERN;
  const hasCustomTeacherPattern = !!config.teacherPattern;
  const kuratorPattern = config.kuratorPattern || DEFAULT_KURATOR_PATTERN;
  const examPattern = config.examPattern || DEFAULT_EXAM_PATTERN;

  // Если переданы кастомные паттерны типов, обучаем классификатор
  if (config.typePatterns) {
    for (const [type, patterns] of Object.entries(config.typePatterns)) {
      for (const pattern of patterns) {
        classifier.learn(pattern, type);
      }
    }
  }

  /**
   * Извлекает аудиторию из текста
   * Примеры: "№7 корп. 345", "спорттук аянтча", "кл. каб 345", "ауд. 345", "ауд 345", "Оптика"
   */
  function extractRoom(text: string): ExtractedField | null {
    const normalized = norm(text);
    if (!normalized) return null;

    const match = normalized.match(roomPattern);
    if (!match) return null;

    const value = match[0].replace(/\s+/g, ' ').trim();
    // Confidence зависит от специфичности паттерна
    let confidence = 0.8;
    if (/№\d+\s*корп/.test(value)) confidence = 0.95;
    else if (/спорттук\s+аянтча/i.test(value)) confidence = 0.9;
    else if (/кл\.\s*каб/i.test(value)) confidence = 0.85;
    else if (/ауд\.?\s*\d+/i.test(value)) confidence = 0.85;
    else if (/^Оптика$/i.test(value)) confidence = 0.9;

    return { value, confidence };
  }

  /**
   * Извлекает преподавателя из текста
   * Форматы: "Иванов И.И.", "Иванов И. И.", "Иванов И И"
   * Также поддерживает кыргызские форматы: 
   *   - "Улукбек кызы Э.", "Кадырбек уулу М." (Имя кызы/уулу И.)
   *   - "Айтиев Урбай кызы Н." (Фамилия Имя кызы/уулу И.)
   *   - "Фамилия Имя Отчество кызы/уулу И." (полный формат)
   */
  function extractTeacher(text: string, customTeacherPattern?: RegExp, roomValue?: string): ExtractedField | null {
    const normalized = norm(text);
    if (!normalized) return null;

    // Если передан кастомный паттерн (через параметр функции), используем только его
    if (customTeacherPattern) {
      const match = normalized.match(customTeacherPattern);
      if (!match) return null;
      const value = match[0].replace(/\s+/g, ' ').trim();
      return { value, confidence: 0.9 };
    }

    // Если в конфиге задан кастомный паттерн преподавателя, используем его
    if (hasCustomTeacherPattern) {
      const match = normalized.match(teacherPattern);
      if (!match) return null;
      const value = match[0].replace(/\s+/g, ' ').trim();
      return { value, confidence: 0.9 };
    }

    // Паттерн для стандартного ФИО: Фамилия И.О. или Фамилия И О (макс 2 инициала: "И.И.", "И. И.", "И И")
    // Используем negative lookbehind вместо \b, так как \b не работает с кириллицей
    const standardPattern = /(?<![А-ЯЁа-яё])([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.?(?:\s*[А-ЯЁ]\.?){0,1})/g;
    // Паттерн для кыргызских имен (короткий): Имя кызы/уулу И. (регистронезависимый для кызы/уулу)
    const kyrgyzShortPattern = /([А-ЯЁ][а-яё]+\s+(?:[Кк][Ыы][Зз][Ыы]|[Уу][Уу][Лл][Уу])\s+[А-ЯЁ]\.?)/g;
    // Паттерн для кыргызских имен (средний): Фамилия Имя кызы/уулу И.
    const kyrgyzPattern = /([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+(?:[Кк][Ыы][Зз][Ыы]|[Уу][Уу][Лл][Уу])\s+[А-ЯЁ]\.?)/g;
    // Паттерн для полного кыргызского ФИО: Фамилия Имя Отчество кызы/уулу И.
    const kyrgyzFullPattern = /([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+(?:[Кк][Ыы][Зз][Ыы]|[Уу][Уу][Лл][Уу])\s+[А-ЯЁ]\.?)/g;

    const allMatches: Array<{match: string; index: number; patternType: 'standard' | 'kyrgyz-short' | 'kyrgyz' | 'kyrgyz-full'}> = [];

    // Собираем все совпадения с их позициями (приоритет: полные -> средние -> короткие -> стандартные)
    for (const m of normalized.matchAll(kyrgyzFullPattern)) {
      allMatches.push({ match: m[0].trim(), index: m.index!, patternType: 'kyrgyz-full' });
    }
    for (const m of normalized.matchAll(kyrgyzPattern)) {
      allMatches.push({ match: m[0].trim(), index: m.index!, patternType: 'kyrgyz' });
    }
    for (const m of normalized.matchAll(kyrgyzShortPattern)) {
      allMatches.push({ match: m[0].trim(), index: m.index!, patternType: 'kyrgyz-short' });
    }
    for (const m of normalized.matchAll(standardPattern)) {
      allMatches.push({ match: m[0].trim(), index: m.index!, patternType: 'standard' });
    }

    console.log('[DEBUG extractTeacher] allMatches:', allMatches);

    if (!allMatches.length) return null;

    // Фильтруем ложные срабатывания (например, "спорттук аянтча К")
    const validMatches = allMatches.filter(m => {
      const words = m.match.split(/\s+/);
      // Не должно быть слов типа "спорттук", "аянтча", "корп", "корпус", "№"
      const lowerMatch = m.match.toLowerCase();
      if (lowerMatch.includes('спорттук') || lowerMatch.includes('аянтча') || 
          lowerMatch.includes('корп') || lowerMatch.includes('корпус') ||
          lowerMatch.includes('№') || lowerMatch.includes('ауд') ||
          lowerMatch.includes('кл.')) {
        return false;
      }
      // Исключаем совпадения, которые начинаются с названия аудитории (например, "Оптика Г. А")
      if (roomValue && m.match.startsWith(roomValue)) {
        return false;
      }
      // Первое слово (фамилия/имя) должно быть достаточно длинным
      if (!words[0] || words[0].length < 3) return false;
      // Лимиты слов по типу паттерна
      switch (m.patternType) {
        case 'standard':
          if (words.length > 3) return false; // Фамилия + макс 2 инициала = 3 слова
          // Дополнительная проверка: не более 2 инициалов в совпадении (после фамилии)
          const initialsPart = words.slice(1).join(' ');
          const initialCount = (initialsPart.match(/[А-ЯЁ]\.?/g) || []).length;
          if (initialCount > 2) return false;
          break;
        case 'kyrgyz-short':
          if (words.length > 3) return false; // Имя + кызы/уулу + И. = 3 слова
          break;
        case 'kyrgyz':
          if (words.length > 4) return false; // Фамилия + Имя + кызы/уулу + И. = 4 слова
          break;
        case 'kyrgyz-full':
          if (words.length > 5) return false; // Фамилия + Имя + Отчество + кызы/уулу + И. = 5 слов
          break;
      }
      return true;
    });

    console.log('[DEBUG extractTeacher] validMatches:', validMatches);

    if (!validMatches.length) return null;

    // Для кыргызских имен предпочитаем более полные совпадения (с фамилией)
    // Сортируем: кыргызские по убыванию количества слов (более полные сначала),
    // затем стандартные по позиции (последние в тексте)
    const kyrgyzMatches = validMatches.filter(m => /(?:кызы|уулу)/i.test(m.match));
    const standardMatches = validMatches.filter(m => !/(?:кызы|уулу)/i.test(m.match));

    let candidate: string;
    if (kyrgyzMatches.length > 0) {
      // Берем кыргызское совпадение с максимальным количеством слов (самое полное)
      kyrgyzMatches.sort((a, b) => b.match.split(/\s+/).length - a.match.split(/\s+/).length);
      candidate = kyrgyzMatches[0].match.replace(/\s+/g, ' ');
    } else if (standardMatches.length > 0) {
      // Для стандартных берем последнее по позиции (обычно преподаватель в конце)
      standardMatches.sort((a, b) => a.index - b.index);
      candidate = standardMatches[standardMatches.length - 1].match.replace(/\s+/g, ' ');
    } else {
      return null;
    }

    console.log('[DEBUG extractTeacher] candidate:', candidate);

    // Проверка: не является ли кандидат частичным совпадением (за ним следуют еще инициалы)
    // Находим позицию кандидата в нормализованном тексте
    const candidateIndex = normalized.indexOf(candidate);
    if (candidateIndex >= 0) {
      const afterCandidate = normalized.slice(candidateIndex + candidate.length);
      // Если после кандидата сразу идут инициалы (буква + точка), это частичное совпадение
      if (/^\s*[А-ЯЁ]\./.test(afterCandidate)) {
        return null;
      }
    }

    // Confidence выше для стандартного формата ФИО (с точками или без)
    let confidence = 0.85;
    if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?(?:\s*[А-ЯЁ]\.?){0,1}$/.test(candidate)) confidence = 0.95;
    else if (/^[А-ЯЁ][а-яё]+\s+(?:кызы|уулу)\s+[А-ЯЁ]\.?$/i.test(candidate)) confidence = 0.9;
    else if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+(?:кызы|уулу)\s+[А-ЯЁ]\.?$/i.test(candidate)) confidence = 0.9;
    else if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+(?:кызы|уулу)\s+[А-ЯЁ]\.?$/i.test(candidate)) confidence = 0.95;

    return { value: candidate, confidence };
  }

  /**
   * Извлекает тип занятия используя TypeClassifier
   */
  function extractType(text: string): ExtractedField | null {
    const normalized = norm(text);
    if (!normalized) return null;

    const classification: ClassificationResult = classifier.classify(normalized);
    if (classification.type === LESSON_TYPES.UNKNOWN || classification.confidence < 0.3) {
      return null;
    }

    // Проверка явных ключевых слов типа занятия
    const hasExplicitTypeKeyword = /(?:^|[\s.,;:])(?:пр|практ|практика|семинар|сем|лаб|лабораторн|лек|лекц|лекция)(?=$|[\s.,;:])/i.test(normalized);
    
    // Для PRACTICE и OTHER требуем явное ключевое слово, если confidence не очень высокий
    if ((classification.type === LESSON_TYPES.PRACTICE || classification.type === LESSON_TYPES.OTHER) && classification.confidence < 0.8) {
      if (!hasExplicitTypeKeyword) return null;
    }
    // Для LECTURE и LAB также требуем ключевое слово при низком confidence
    if ((classification.type === LESSON_TYPES.LECTURE || classification.type === LESSON_TYPES.LAB) && classification.confidence < 0.5) {
      if (!hasExplicitTypeKeyword) return null;
    }

    const value = mapClassifierTypeToTypeId(classification.type);
    return { value, confidence: classification.confidence };
  }

  /**
   * Извлекает предмет как всё остальное после удаления type/room/teacher
   */
  function extractSubject(
    text: string,
    extracted: { type?: ExtractedField | null; room?: ExtractedField | null; teacher?: ExtractedField | null }
  ): ExtractedField {
    const normalized = norm(text);
    if (!normalized) return { value: '', confidence: 0 };

    let subject = normalized;

    // Удаляем комнату
    if (extracted.room?.value) {
      const roomIdx = subject.indexOf(extracted.room.value);
      if (roomIdx >= 0) {
        subject = subject.slice(0, roomIdx) + subject.slice(roomIdx + extracted.room.value.length);
      }
    }

    // Удаляем преподавателя
    if (extracted.teacher?.value) {
      const teacherIdx = subject.indexOf(extracted.teacher.value);
      if (teacherIdx >= 0) {
        subject = subject.slice(0, teacherIdx) + subject.slice(teacherIdx + extracted.teacher.value.length);
      }
    }

    // Удаляем ключевые слова типа занятия из начала И из середины
    const typeKeywords = /(?:^|[\s.,;:])(?:лекция|лек\.?|лабораторн[а-я]*|лаб\.?|практика|практ\.?|пр\.?|семинар|сем\.?)(?=$|[\s.,;:])/gi;
    subject = subject.replace(typeKeywords, ' ');

    // Очищаем от служебных слов и лишних разделителей
    subject = subject
      .replace(/[,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Если после очистки пусто, возвращаем исходный текст
    const value = subject || normalized;

    // Confidence предмета зависит от того, сколько полей удалось извлечь
    let confidence = 0.7;
    const extractedCount = [extracted.type, extracted.room, extracted.teacher].filter(Boolean).length;
    if (extractedCount >= 2) confidence = 0.9;
    else if (extractedCount === 1) confidence = 0.8;

    return { value, confidence };
  }

  /**
   * Извлекает все поля сразу
   */
  function extractAll(text: string): ExtractedAllFields {
    const normalized = norm(text);
    if (!normalized) {
      return {
        type: null,
        room: null,
        teacher: null,
        subject: { value: '', confidence: 0 },
        confidence: 0,
      };
    }

    // Специальная обработка кураторского часа
    if (kuratorPattern.test(normalized)) {
      return {
        type: { value: TYPE_IDS.OTHER, confidence: 1.0 },
        room: { value: '', confidence: 1.0 },
        teacher: { value: '', confidence: 1.0 },
        subject: { value: 'Кураторский час', confidence: 1.0 },
        confidence: 1.0,
      };
    }

    // Извлекаем поля в порядке: room, teacher, type (type из оставшегося текста)
    const room = extractRoom(normalized);
    const teacher = extractTeacher(normalized, undefined, room?.value);

    // Для типа используем текст без комнаты и преподавателя
    let textForType = normalized;
    if (room?.value) {
      const idx = textForType.indexOf(room.value);
      if (idx >= 0) textForType = textForType.slice(0, idx) + textForType.slice(idx + room.value.length);
    }
    if (teacher?.value) {
      const idx = textForType.indexOf(teacher.value);
      if (idx >= 0) textForType = textForType.slice(0, idx) + textForType.slice(idx + teacher.value.length);
    }

    let type = extractType(textForType);

    // Если тип не определен (null) ИЛИ тип OTHER без явного ключевого слова, но есть комната И преподаватель — по умолчанию практика
    const hasExplicitTypeKeyword = /(?:^|[\s.,;:])(?:пр|практ|практика|семинар|сем|лаб|лабораторн|лек|лекц|лекция)(?=$|[\s.,;:])/i.test(textForType);
    if ((!type || (type.value === TYPE_IDS.OTHER && !hasExplicitTypeKeyword)) && room?.value && teacher?.value) {
      type = { value: TYPE_IDS.PRACTICE, confidence: 0.6 };
    }

    // Извлекаем предмет зная остальные поля
    const subject = extractSubject(normalized, { type, room, teacher });

    const confidence = calculateOverallConfidence({ type, room, teacher, subject });

    return { type, room, teacher, subject, confidence };
  }

  return {
    extractRoom,
    extractTeacher,
    extractType,
    extractSubject,
    extractAll,
    classifier,
  };
}

/**
 * Singleton instance для удобства
 */
export const fieldExtractor = createFieldExtractor();

/**
 * Сбрасывает классификатор к базовым паттернам
 */
export function resetFieldExtractor(): void {
  classifier.reset();
}