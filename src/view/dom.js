/**
 * Безопасный querySelector c проверкой наличия.
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return /** @type {T} */ (el);
}

export function fillSelect(select, values, allLabel, formatter) {
  const current = select.value;
  const opts = [`<option value="">${allLabel}</option>`].concat(
    values.map((v) => {
      const lbl = formatter ? formatter(v) : escapeHtml(String(v));
      return `<option value="${escapeHtml(String(v))}">${lbl}</option>`;
    })
  );
  select.innerHTML = opts.join('');
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
