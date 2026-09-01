/**
 * Унифицированный выбор файла Excel на устройстве.
 *
 * Использует File System Access API (window.showOpenFilePicker) — нативный
 * диалог ОС/Android/iOS для поиска файла на устройстве с фильтром по типу
 * (только .xls/.xlsx). Поддерживается в Chrome 86+, Edge 86+, Android WebView.
 *
 * Fallback: <input type=file> для Safari, Firefox, старых браузеров.
 *
 * @typedef {Object} PickedFile
 * @property {string} name - имя файла
 * @property {File} file - File-объект (для чтения через arrayBuffer)
 * @property {FileSystemFileHandle|null} handle - опциональный handle для повторного открытия
 */

/**
 * @param {{multiple?: boolean}} [opts]
 * @returns {Promise<PickedFile[]>}
 */
export async function pickExcelFile(opts = {}) {
  const multiple = opts.multiple === true;
  const accept = [
    {
      description: 'Excel',
      accept: {
        'application/vnd.ms-excel': ['.xls'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'text/csv': ['.csv']
      }
    }
  ];

  // File System Access API
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      /** @type {FileSystemFileHandle[]} */
      const handles = await window.showOpenFilePicker({ multiple, types: accept, excludeAcceptAllOption: false });
      const out = [];
      for (const h of handles) {
        const file = await h.getFile();
        out.push({ name: file.name, file, handle: h });
      }
      return out;
    } catch (err) {
      // User cancelled (AbortError) — пробрасываем наверх
      if (err && err.name === 'AbortError') return [];
      // Permission/security/другое — падаем в fallback
      console.warn('showOpenFilePicker failed, fallback to <input>:', err);
    }
  }

  // Fallback: динамический <input type=file>
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      resolve(files.map((f) => ({ name: f.name, file: f, handle: null })));
      input.remove();
    }, { once: true });
    // Если пользователь отменил — change не сработает. Чистим при focus.
    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => { if (input.parentNode) input.remove(); }, 1000);
    };
    const onFocus = () => {
      // Через секунду после возврата фокуса проверим, был ли выбор
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          resolve([]);
          cleanup();
        }
      }, 300);
    };
    window.addEventListener('focus', onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Проверяет, доступен ли File System Access API.
 * @returns {boolean}
 */
export function hasNativeFilePicker() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}
