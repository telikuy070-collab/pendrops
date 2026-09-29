/**
 * Schedule status banner.
 *
 * A small, dependency-free surface for two confirmed failure modes:
 * - a failed authoritative load — the cached schedule stays on screen and the
 *   user gets a visible, retryable error;
 * - a failed offline cache write — a retryable warning that never hides or
 *   discards the data that is already applied.
 */

const KIND_CLASS = {
  error: 'schedule-status schedule-status-error',
  warn: 'schedule-status schedule-status-warn',
};

/**
 * @param {Document} [doc]
 */
export function createScheduleStatusBanner(doc = document) {
  /** @type {HTMLElement|null} */
  let element = null;
  /** @type {(() => void)|null} */
  let onRetry = null;

  const host = () => {
    if (element && element.isConnected) return element;
    const container = doc.getElementById('scheduleContainer');
    if (!container) return null;
    const created = doc.createElement('div');
    created.id = 'scheduleStatus';
    created.setAttribute('role', 'status');
    created.setAttribute('aria-live', 'polite');
    created.hidden = true;
    container.parentNode.insertBefore(created, container);
    element = created;
    return created;
  };

  const clear = () => {
    const el = element;
    if (!el) return;
    el.textContent = '';
    el.className = 'schedule-status';
    el.hidden = true;
    onRetry = null;
  };

  return {
    /**
     * @param {'error'|'warn'} kind
     * @param {string} message
     * @param {{onRetry?: () => void, retryLabel?: string}} [options]
     */
    show(kind, message, options = {}) {
      const el = host();
      if (!el) return;
      el.textContent = '';
      el.className = KIND_CLASS[kind] || KIND_CLASS.error;
      const text = doc.createElement('span');
      text.className = 'schedule-status-text';
      text.textContent = message;
      el.appendChild(text);

      if (typeof options.onRetry === 'function') {
        onRetry = options.onRetry;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost small schedule-status-retry';
        button.textContent = options.retryLabel || 'Повторить';
        button.addEventListener('click', () => {
          const retry = onRetry;
          onRetry = null;
          if (retry) retry();
        });
        el.appendChild(button);
      }
      el.hidden = false;
    },
    hide: clear,
    isVisible() {
      return Boolean(element && !element.hidden);
    },
  };
}
