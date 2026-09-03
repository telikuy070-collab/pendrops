/**
 * Toast — короткие уведомления внизу экрана.
 * Поддерживает опциональную кнопку действия (например «Обновить»).
 */
let timer = null;

export function createToast(el) {
  return {
    show(message, kind = 'ok', action = null) {
      el.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = message;
      el.appendChild(span);

      if (action && typeof action.onClick === 'function') {
        const btn = document.createElement('button');
        btn.className = 'toast-btn';
        btn.textContent = action.label || 'OK';
        btn.addEventListener('click', () => {
          action.onClick();
          el.classList.remove('show');
        });
        el.appendChild(btn);
      }

      el.className = 'toast show ' + kind;
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), 3500);
    },
  };
}
