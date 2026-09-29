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
  PublishFileMeta,
  PublishOptions,
  PublishResult,
  SchedulePreview,
} from '@core/domain/repositories/ports';
import type { PublishLessonV1 } from '../../../parser/publishWire.ts';
import { ValidationError } from '@core/domain/errors';
import { toPublishableLessons } from '../../../parser/draft.ts';
import {
  loadScheduleUseCase,
  loadCachedScheduleUseCase,
  refreshScheduleUseCase,
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

  /** Cached snapshot for an instant first render, or null when there is none. */
  async loadCached(): Promise<ScheduleData | null> {
    return loadCachedScheduleUseCase(this.storage);
  }

  /**
   * Authoritative reload with a best-effort offline cache refresh.
   *
   * Callers apply the returned data immediately; a failed cache write is
   * reported through `cacheUpdated` and must never remove cached data.
   */
  async refresh(_reason: string): Promise<{ data: ScheduleData; cacheUpdated: boolean }> {
    return refreshScheduleUseCase(this.repository, this.storage);
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
  /**
   * The draft of the file the admin last inspected, kept so publishing reuses
   * the parse the preview showed instead of running the engine a second time.
   */
  private pendingPreview: SchedulePreview | null = null;

  constructor(
    private repository: IScheduleRepository,
    private parser: IFileParser
  ) {}

  /**
   * Parse a file once and describe what publishing it would do.
   *
   * The returned draft is retained; `publishPreview` writes exactly these
   * records, so what the admin reviewed is what reaches the database.
   */
  async previewFromExcel(file: ArrayBuffer | File): Promise<SchedulePreview> {
    const preview = await this.parser.previewWorkbook(file);
    this.pendingPreview = preview;
    return preview;
  }

  /** Drops the retained preview, e.g. when the admin resets the dialog. */
  clearPreview(): void {
    this.pendingPreview = null;
  }

  /**
   * Publish the file the preview was built from.
   *
   * Refuses to run without a preview so a file can never reach the database
   * without having been parsed once, and keeps the retained draft afterwards so
   * a publish aborted halfway can be restarted without parsing again.
   */
  async publishPreview(file: ArrayBuffer | File, options?: PublishOptions): Promise<PublishResult> {
    const preview = this.pendingPreview;
    if (!preview) {
      throw new ValidationError('Файл не разобран: сначала дождитесь предпросмотра');
    }
    return this.#write(preview.draft.lessons, file, options);
  }

  /** Publish schedule from Excel file, parsing it exactly once. */
  async publishFromExcel(
    file: ArrayBuffer | File,
    options?: PublishOptions
  ): Promise<PublishResult> {
    const preview = await this.previewFromExcel(file);
    return this.#write(preview.draft.lessons, file, options);
  }

  /** Publish schedule from parsed lessons (used by a snapshot rollback). */
  async publishLessons(
    lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[],
    meta?: PublishFileMeta,
    options?: PublishOptions
  ): Promise<PublishResult> {
    return this.repository.publish(lessons, meta, options);
  }

  /** Hands one parse to the repository; the file only supplies its metadata. */
  #write(
    records: PublishLessonV1[],
    file: ArrayBuffer | File,
    options?: PublishOptions
  ): Promise<PublishResult> {
    // File name/size are only known when a real File was picked; a raw
    // ArrayBuffer (tests, workers) publishes without that metadata.
    const isFile = typeof File !== 'undefined' && file instanceof File;
    return this.repository.publish(
      toPublishableLessons(records),
      {
        fileName: isFile ? file.name : null,
        fileSize: isFile ? file.size : null,
      },
      options
    );
  }
}
