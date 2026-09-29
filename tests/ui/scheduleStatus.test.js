// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleStatusBanner } from '../../src/view/scheduleStatus.js';

describe('schedule status banner', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<main id="scheduleContainer"><div class="cached">cached</div></main>';
  });

  it('is hidden until an error or warning is shown', () => {
    const banner = createScheduleStatusBanner();
    expect(banner.isVisible()).toBe(false);
    expect(document.getElementById('scheduleStatus')).toBeNull();
  });

  it('shows a retryable error while keeping the cached schedule in the DOM', () => {
    const onRetry = vi.fn();
    const banner = createScheduleStatusBanner();
    banner.show('error', 'Проблема с сетью', { onRetry });

    const element = document.getElementById('scheduleStatus');
    expect(banner.isVisible()).toBe(true);
    expect(element.hidden).toBe(false);
    expect(element.className).toMatch(/schedule-status-error/);
    expect(element.textContent).toContain('Проблема с сетью');
    // The schedule itself is untouched: cached data is preserved.
    expect(document.querySelector('#scheduleContainer .cached')).not.toBeNull();

    element.querySelector('button').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retries only once per shown banner', () => {
    const onRetry = vi.fn();
    const banner = createScheduleStatusBanner();
    banner.show('warn', 'Не удалось обновить офлайн-копию', { onRetry });
    const button = document.querySelector('.schedule-status-retry');
    button.click();
    button.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a warning without a retry action when none is supplied', () => {
    const banner = createScheduleStatusBanner();
    banner.show('warn', 'Офлайн-копия устарела');
    const element = document.getElementById('scheduleStatus');
    expect(element.className).toMatch(/schedule-status-warn/);
    expect(element.querySelector('button')).toBeNull();
  });

  it('hides the banner and clears its text on success', () => {
    const banner = createScheduleStatusBanner();
    banner.show('error', 'Ошибка', { onRetry: () => {} });
    banner.hide();
    const element = document.getElementById('scheduleStatus');
    expect(banner.isVisible()).toBe(false);
    expect(element.textContent).toBe('');
  });

  it('escapes message content instead of injecting markup', () => {
    const banner = createScheduleStatusBanner();
    banner.show('error', '<img src=x onerror=alert(1)>');
    const element = document.getElementById('scheduleStatus');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
