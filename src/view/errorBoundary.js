/**
 * Error Boundary Web Component.
 *
 * Catches render-time errors in the schedule view and displays a friendly
 * fallback UI instead of a crashed app. Usage:
 *
 *   <error-boundary id="scheduleError" message="Не удалось загрузить расписание">
 *     <!-- child content rendered by app -->
 *   </error-boundary>
 *
 * The boundary listens for a custom `error` event (bubbles from anywhere)
 * or you can call `boundary.reportError(err)` imperatively.
 */

/** CSS injected into shadow DOM — kept minimal to avoid theme conflicts. */
const styles = `
  :host {
    display: block;
    padding: 1.5rem;
    text-align: center;
    color: #ef4444;
  }
  .error-boundary {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  h2 { font-size: 1.25rem; margin: 0; }
  p { margin: 0; color: #647494; font-size: 0.9rem; }
  button { margin-top: 0.5rem; padding: 0.5rem 1rem; }
`;

/**
 * @typedef {Object} ErrorBoundaryDetail
 * @property {string} message - user-facing message
 * @property {Error} [originalError] - the underlying error
 * @property {number} [timestamp] - when the error occurred
 */

const TEMPLATE_ID = 'template-error-boundary';

/** Ensure the HTML template element exists in the document. */
function ensureTemplate() {
  if (typeof document === 'undefined') return null;
  let t = document.getElementById(TEMPLATE_ID);
  if (!t) {
    t = document.createElement('template');
    t.id = TEMPLATE_ID;
    t.innerHTML = `
      <style>${styles}</style>
      <div class="error-boundary" role="alert" aria-live="polite">
        <h2>⚠️ Что-то пошло не так</h2>
        <p class="error-message"></p>
        <button type="button" class="error-reload">Перезагрузить</button>
      </div>
    `;
    document.body.appendChild(t);
  }
  return t;
}

export class ErrorBoundary extends HTMLElement {
  static get observedAttributes() {
    return ['message', 'title'];
  }

  constructor() {
    super();
    /** @type {ErrorBoundaryDetail | null} */
    this._detail = null;
  }

  connectedCallback() {
    this.render();
    // Listen for custom error events dispatched on document
    if (!this._boundHandleError) {
      this._boundHandleError = this.handleError.bind(this);
      document.addEventListener('pendrops-error', this._boundHandleError);
    }
  }

  disconnectedCallback() {
    if (this._boundHandleError) {
      document.removeEventListener('pendrops-error', this._boundHandleError);
      this._boundHandleError = null;
    }
  }

  attributeChangedCallback(name, _oldVal, _newVal) {
    if (name === 'message' || name === 'title') this.render();
  }

  /**
   * Imperative API: report an error programmatically.
   * @param {Error|string|unknown} err
   */
  reportError(err) {
    this.handleError({ detail: { originalError: err } });
  }

  /**
   * @param {CustomEvent<ErrorBoundaryDetail>} e
   */
  handleError(e) {
    const detail = e?.detail || { originalError: e };
    this._detail = detail;
    this.render();
  }

  render() {
    const tmpl = ensureTemplate();
    const message = this.getAttribute('message') || 'Что-то пошло не так';
    const title = this.getAttribute('title') || '⚠️ Ошибка';

    // If shadow DOM is supported, use it for style isolation
    if (this.attachShadow) {
      if (!this.shadowRoot) {
        const shadow = this.attachShadow({ mode: 'open' });
        const clone = tmpl.content.cloneNode(true);
        shadow.appendChild(clone);
        this._wireEvents(shadow);
      }
      // Update text content
      const msgEl = this.shadowRoot.querySelector('.error-message');
      if (msgEl) msgEl.textContent = this._detail?.originalError?.message || message;
    } else {
      // Fallback: render directly (no style isolation)
      this.innerHTML = `
        <style>${styles}</style>
        <div class="error-boundary" role="alert" aria-live="polite">
          <h2>${title}</h2>
          <p>${this._detail?.originalError?.message || message}</p>
          <button type="button" class="error-reload">Перезагрузить</button>
        </div>
      `;
      this.querySelector('.error-reload')?.addEventListener('click', () => location.reload());
    }
  }

  _wireEvents(root) {
    root.querySelector('.error-reload')?.addEventListener('click', () => {
      location.reload();
    });
  }
}

// Register the custom element (idempotent)
if (typeof customElements !== 'undefined' && !customElements.get('error-boundary')) {
  customElements.define('error-boundary', ErrorBoundary);
}

/**
 * Dispatch a global error event that any ErrorBoundary in the DOM can catch.
 * Use this in catch blocks to surface errors to the UI.
 *
 * @param {Error|string|unknown} err
 * @param {string} [message] - optional override message
 */
export function reportError(err, message) {
  if (typeof document === 'undefined') {
    console.error(err);
    return;
  }
  document.dispatchEvent(
    new CustomEvent('pendrops-error', {
      detail: { originalError: err, message },
    })
  );
}

export default ErrorBoundary;
