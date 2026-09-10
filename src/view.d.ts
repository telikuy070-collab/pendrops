// Type declarations for existing view modules (JS files)
export function createToast(container: HTMLElement | null): {
  show(message: string, type?: 'ok' | 'bad' | 'info', options?: { label: string; onClick: () => void }): void;
};

export function createScheduleView(container: HTMLElement | null): {
  render(lessons: any[], options: { today: string }): void;
  start(): void;
  setOnRefresh(handler: () => Promise<void>): void;
};

export function createAdminView(): {
  show(): void;
  hide(): void;
  onPublish(callback: (file: File) => Promise<void>): void;
};

export function initBrandGesture(
  authService: { isAdmin(): boolean; verifyPin(pin: string): Promise<boolean> },
  adminService: { publishFromExcel(file: File): Promise<void> },
  toast: ReturnType<typeof createToast>
): void;

// Text utilities
export function escapeHtml(s: any): string;
export function debounce<T extends (...args: any[]) => any>(fn: T, ms?: number): T;
export function norm(v: any): string;
export function lower(v: any): string;
export function noSpace(v: any): string;
export function uniqueSorted(arr: any[], locale?: string): any[];