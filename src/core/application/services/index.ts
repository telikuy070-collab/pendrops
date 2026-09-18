/**
 * Application Services - Orchestrate use cases, handle cross-cutting concerns
 * These are the main entry points for the presentation layer
 */
import type {
  ScheduleData,
  Lesson,
  UserPreferences,
  Sheet,
  Group,
} from '@core/domain/entities/types';
import type {
  IScheduleRepository,
  IAuthProvider,
  IStorage,
  IFileParser,
} from '@core/domain/repositories/ports';
import {
  loadScheduleUseCase,
  subscribeScheduleUseCase,
  checkUpdatesUseCase,
  savePreferencesUseCase,
  loadPreferencesUseCase,
  filterLessonsUseCase,
  getSheetsUseCase,
  getGroupsUseCase,
} from '@core/domain/use-cases/schedule';

export class ScheduleService {
  constructor(
    private repository: IScheduleRepository,
    private storage: IStorage
  ) {}

  async load(): Promise<ScheduleData> {
    return loadScheduleUseCase(this.repository, this.storage);
  }

  subscribe(onUpdate: (data: ScheduleData) => void): () => void {
    return subscribeScheduleUseCase(this.repository, onUpdate);
  }

  async checkUpdates(currentVersion: string) {
    return checkUpdatesUseCase(this.repository, currentVersion);
  }

  /** Apply incremental changes to cached schedule */
  async applyIncrementalChanges(changes: Lesson[]): Promise<void> {
    // This will be handled by the presentation layer merging changes
    // The repository's subscribe will handle full reload via realtime
    // For now, we just return the changes for the caller to handle
    return;
  }

  async getFilteredLessons(
    prefs: UserPreferences,
    filters: { day?: string; search?: string }
  ): Promise<Lesson[]> {
    const data = await this.load();
    const allLessons = Array.from(data.sheets.values()).flat();
    return filterLessonsUseCase(allLessons, prefs, filters);
  }

  async getSheets(): Promise<Sheet[]> {
    const data = await this.load();
    const allLessons = Array.from(data.sheets.values()).flat();
    return getSheetsUseCase(allLessons);
  }

  async getGroups(sheetId: string): Promise<Group[]> {
    const data = await this.load();
    const allLessons = Array.from(data.sheets.values()).flat();
    return getGroupsUseCase(allLessons, sheetId);
  }
}

export class PreferencesService {
  constructor(private storage: IStorage) {}

  async load(): Promise<UserPreferences> {
    return loadPreferencesUseCase(this.storage);
  }

  async save(prefs: Partial<UserPreferences>): Promise<void> {
    return savePreferencesUseCase(this.storage, prefs);
  }
}

export class AuthService {
  constructor(private auth: IAuthProvider) {}

  async verifyPin(pin: string): Promise<boolean> {
    return this.auth.verifyPin(pin);
  }

  isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  async getSession() {
    return this.auth.getSession();
  }
}

export class AdminService {
  constructor(
    private repository: IScheduleRepository,
    private parser: IFileParser
  ) {}

  /** Publish schedule from Excel file */
  async publishFromExcel(file: ArrayBuffer | File): Promise<void> {
    const workbook = await this.parser.parseExcel(file);
    await this.repository.publishFromWorkbook(workbook, null);
  }

  /** Publish schedule from parsed lessons */
  async publishLessons(lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void> {
    await this.repository.publish(lessons);
  }
}
