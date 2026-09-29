/**
 * Install / add-to-home-screen UX.
 *
 * Browsers disagree on how a PWA is installed, so the panel has three states:
 *
 * 1. Chromium fires `beforeinstallprompt`, we defer the event and offer a real
 *    button that calls `prompt()`. `appinstalled` then confirms the install.
 * 2. iOS Safari has no such event: the only supported route is the share sheet
 *    ("Поделиться" -> "На экран «Домой»"), so we show that instruction instead
 *    of a button that could not do anything.
 * 3. Already installed (`display-mode: standalone`) — the panel never appears.
 *
 * The panel is a first-run affordance, not a permanent control: it is hidden
 * once dismissed and never shown in an installed window.
 */

import { logger } from '@shared/logger';

/** Non-standard `BeforeInstallPromptEvent`, shipped in Chromium only. */
interface DeferredInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallElements {
  panel: HTMLElement | null;
  title: HTMLElement | null;
  subtitle: HTMLElement | null;
  button: HTMLButtonElement | null;
  dismiss: HTMLButtonElement | null;
}

export interface InstallOptions {
  /** Called after a successful `prompt()` so the host can report the outcome. */
  onInstalled?: () => void;
  onDismissed?: () => void;
}

/** Remembers a manual dismissal across sessions. */
const DISMISSED_KEY = 'pendrops:install-dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private mode / blocked storage: show the panel again rather than hide it
    // behind a state we cannot persist.
    return false;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Non-fatal: the panel stays dismissible for this session only.
  }
}

/** True when the document is already running as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true; // iOS Safari
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  );
}

/**
 * iOS detection by user agent, as required: iPadOS 13+ reports a desktop
 * Safari UA, so the touch-point heuristic is needed for iPad.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Wires the install panel. Safe to call once per document; it is a no-op in an
 * already installed window and when the markup is absent.
 */
export function initInstallPrompt(elements: InstallElements, options: InstallOptions = {}): void {
  const { panel, title, subtitle, button, dismiss } = elements;
  if (!panel) return;

  let deferred: DeferredInstallPrompt | null = null;
  let settled = false; // the user answered the native dialog in this session

  const show = (): void => {
    if (isStandalone() || isDismissed()) return;
    panel.classList.remove('hidden');
  };

  const hide = (): void => {
    panel.classList.add('hidden');
  };

  /** iOS has no programmatic install path: teach the gesture instead. */
  const showIosHint = (): void => {
    if (settled || isDismissed() || isStandalone()) return;
    if (title) title.textContent = 'Добавьте на экран «Домой»';
    if (subtitle) {
      subtitle.textContent =
        'В Safari нажмите «Поделиться» → «На экран „Домой“». Приложение откроется офлайн.';
    }
    button?.classList.add('hidden');
    show();
  };

  const showNativeButton = (): void => {
    if (title) title.textContent = 'Установить на телефон';
    if (subtitle) {
      subtitle.textContent = 'Быстрый запуск с иконки и работа без интернета';
    }
    button?.classList.remove('hidden');
    show();
  };

  if (isStandalone()) {
    hide();
  } else if (isIos()) {
    // No `beforeinstallprompt` will ever arrive, so do not wait for it.
    showIosHint();
  } else {
    window.addEventListener('beforeinstallprompt', (event) => {
      const promptEvent = event as DeferredInstallPrompt;
      promptEvent.preventDefault();
      deferred = promptEvent;
      if (!settled) showNativeButton();
    });
  }

  button?.addEventListener('click', async () => {
    if (!deferred) {
      showIosHint();
      return;
    }
    button.disabled = true;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      settled = true;
      if (outcome === 'accepted') {
        if (title) title.textContent = 'Установлено';
        if (subtitle) subtitle.textContent = 'Приложение появилось на главном экране';
        button.classList.add('hidden');
        options.onInstalled?.();
        // The panel has done its job; a reload in standalone hides it anyway.
        window.setTimeout(hide, 3000);
      } else {
        hide();
        options.onDismissed?.();
      }
    } catch (error) {
      logger.warn('[install] prompt failed', { name: (error as Error)?.name });
      hide();
    } finally {
      button.disabled = false;
      deferred = null;
    }
  });

  window.addEventListener('appinstalled', () => {
    settled = true;
    deferred = null;
    if (title) title.textContent = 'Установлено';
    if (subtitle) subtitle.textContent = 'Приложение появилось на главном экране';
    button?.classList.add('hidden');
    options.onInstalled?.();
    window.setTimeout(hide, 3000);
  });

  dismiss?.addEventListener('click', () => {
    rememberDismissed();
    hide();
    options.onDismissed?.();
  });

  // Installing from the browser menu never fires `appinstalled` in this
  // window, but the display mode does change.
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  standaloneQuery.addEventListener('change', (event) => {
    if (event.matches) hide();
  });
}
