export interface BrandGestureDeps {
  authService: { verifyPin(pin: string): Promise<boolean> | boolean };
  adminView: { show(): void };
  toast?: { show(msg: string, type?: string): void };
}

export function initBrandGesture(deps: BrandGestureDeps): void {
  const brand = document.querySelector('.brand');
  if (!brand) return;

  let pressTimer: number | null = null;
  let pressing = false;
  let hint: HTMLElement | null = null;
  const LONG_PRESS_MS = 1500;

  const showHint = () => {
    if (hint) return;
    hint = document.createElement('div');
    hint.className = 'longpress-hint';
    hint.textContent = 'Админка';
    brand.appendChild(hint);
  };
  const hideHint = () => {
    hint?.remove();
    hint = null;
  };

  brand.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse' && (e as PointerEvent).button !== 0) return;
    pressing = true;
    showHint();
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      if (pressing) {
        pressing = false;
        hideHint();
        deps.adminView?.show();
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, LONG_PRESS_MS);
  });

  const cancel = () => {
    pressing = false;
    if (pressTimer) clearTimeout(pressTimer);
    hideHint();
  };
  brand.addEventListener('pointerup', cancel);
  brand.addEventListener('pointerleave', cancel);
  brand.addEventListener('pointercancel', cancel);

  let clickCount = 0;
  let resetTimer: number | null = null;
  brand.addEventListener('click', async () => {
    clickCount++;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => { clickCount = 0; }, 1200);
    if (clickCount >= 10) {
      clickCount = 0;
      const pin = prompt('Введите PIN для доступа к админке:');
      if (!pin) return;
      const ok = await deps.authService?.verifyPin(pin);
      if (ok) {
        deps.adminView?.show();
        deps.toast?.show?.('Админка разблокирована', 'ok');
      } else {
        deps.toast?.show?.('Неверный PIN', 'bad');
      }
    }
  });
}