/**
 * Offline / stale-data decision.
 *
 * `navigator.onLine` only says whether an interface is up: a captive portal, a
 * dead Wi-Fi or an unreachable Supabase all report "online" while every load
 * fails. So the banner is driven by two independent facts: what the browser
 * claims, and whether the last authoritative load actually worked.
 */

export interface ConnectivityInput {
  /** `navigator.onLine`. */
  browserOnline: boolean;
  /** The last authoritative load failed (network or server). */
  loadFailed: boolean;
  /** There is something on screen to keep showing. */
  hasData: boolean;
  /** `ScheduleData.updatedAt` of the data on screen. */
  updatedAt?: string;
}

export interface ConnectivityResult {
  /** Show the "data may be old" notice. */
  offline: boolean;
  /** Full notice text, empty when nothing should be shown. */
  text: string;
}

/** "08:12" in the device's own timezone; empty when the stamp is unusable. */
export function formatUpdatedClock(updatedAt?: string): string {
  if (!updatedAt) return '';
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return '';
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Decides what the notice says.
 *
 * Not alarming on purpose: the schedule on screen is a working offline copy,
 * the notice only tells the student how old it is.
 */
export function resolveConnectivity(input: ConnectivityInput): ConnectivityResult {
  const offline = !input.browserOnline || input.loadFailed;
  if (!offline) return { offline: false, text: '' };

  if (!input.hasData) {
    return { offline: true, text: 'Офлайн · сохранённого расписания пока нет' };
  }

  const clock = formatUpdatedClock(input.updatedAt);
  if (!clock) {
    return { offline: true, text: 'Офлайн · показываем сохранённое расписание' };
  }
  return { offline: true, text: `Офлайн · последнее обновление в ${clock}` };
}
