export const norm = (v) => (v == null ? '' : String(v).trim());
export const lower = (v) => norm(v).toLowerCase();
export const noSpace = (v) => lower(v).replace(/\s+/g, '');

export const uniqueSorted = (arr, locale = 'ru') =>
  Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b), locale)
  );

export const escapeHtml = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch]
  );

export const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
