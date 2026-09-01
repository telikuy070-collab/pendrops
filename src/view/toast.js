let timer = null;

export function createToast(el) {
  return {
    show(message, kind = 'ok') {
      el.textContent = message;
      el.className = 'toast show ' + kind;
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), 2600);
    }
  };
}
