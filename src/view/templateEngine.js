/**
 * Lightweight template engine using native HTMLTemplateElement.
 *
 * Zero dependencies. Works by cloning a <template> element and interpolating
 * {{key}} placeholders in text nodes.
 */

const TEMPLATE_CACHE = new Map();

/**
 * Loads and caches an HTML template from a file.
 * In a real Vite build, the templates are inlined at build time.
 * In dev mode (python http.server), they're fetched at runtime.
 *
 * @param {string} name - template name (without .html extension)
 * @returns {Promise<HTMLTemplateElement>}
 */
async function loadTemplate(name) {
  if (TEMPLATE_CACHE.has(name)) return TEMPLATE_CACHE.get(name);

  const url = new URL(`./templates/${name}.html`, import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Template ${name} not found: ${res.status}`);
  const html = await res.text();
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html.trim();
  TEMPLATE_CACHE.set(name, tmpl);
  return tmpl;
}

/**
 * Synchronously get a template from the DOM.
 * In the built app, templates are inlined in index.html as <template id="template-*">.
 *
 * @param {string} name
 * @returns {HTMLTemplateElement|null}
 */
function getCachedTemplate(name) {
  return document.getElementById(`template-${name}`);
}

/**
 * Deep-interpolate {{key}} placeholders in a document fragment.
 *
 * @param {DocumentFragment} fragment
 * @param {Record<string, string|number|boolean|null|undefined>} data
 */
function interpolate(fragment, data) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    let html = node.textContent;
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      html = html.replace(
        new RegExp(`{{${key}}}`, 'g'),
        String(value).replace(
          /[&<>"']/g,
          (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
        )
      );
    }
    // Remove any remaining {{key}} placeholders
    html = html.replace(/\{\{[^}]+\}\}/g, '');
    node.textContent = html;
  }
}

/**
 * Render a template with data and return a DocumentFragment.
 *
 * @param {string} name - template name
 * @param {Record<string, string|number|boolean|null|undefined>} data
 * @returns {Promise<DocumentFragment>}
 */
export async function renderTemplate(name, data = {}) {
  const tmpl = getCachedTemplate(name) || (await loadTemplate(name));
  if (!tmpl) throw new Error(`Template ${name} not found`);
  const clone = tmpl.content.cloneNode(true);
  interpolate(clone, data);
  return clone;
}

/**
 * Synchronous template rendering — requires templates to be inlined in DOM.
 * For performance-critical rendering paths.
 *
 * @param {string} name
 * @param {Record<string, string|number|boolean|null|undefined>} data
 * @returns {DocumentFragment|null}
 */
export function renderTemplateSync(name, data = {}) {
  const tmpl = getCachedTemplate(name);
  if (!tmpl) return null;
  const clone = tmpl.content.cloneNode(true);
  interpolate(clone, data);
  return clone;
}
