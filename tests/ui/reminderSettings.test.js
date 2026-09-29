// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderSettings } from '../../src/view/reminderSettings.js';
import { createReminderStore } from '../../src/presentation/reminders';

/**
 * The section is only ever rendered with the ids index.html provides, so the
 * harness builds the same minimal markup the app mounts it into.
 */
function mount() {
  document.body.innerHTML = `
    <div id="reminderSection">
      <div id="reminderLeadRow"></div>
      <div id="reminderEnableBtn"></div>
      <div id="reminderStatus"></div>
      <div id="reminderList"></div>
    </div>
  `;
  return {
    section: document.getElementById('reminderSection'),
    list: document.getElementById('reminderList'),
    leadRow: document.getElementById('reminderLeadRow'),
    enableButton: document.getElementById('reminderEnableBtn'),
    status: document.getElementById('reminderStatus'),
  };
}

const env = (notifications) => ({
  now: () => new Date(2026, 8, 30, 12, 0).getTime(),
  storage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  notifications,
  setInterval: () => 1,
  clearInterval: () => {},
});

const fakeNotifications = (permission) => ({
  permission,
  requestPermission: vi.fn(async () => 'granted'),
  show: () => {},
});

function setup(notifications) {
  const nodes = mount();
  const store = createReminderStore(env(notifications));
  const onRequest = vi.fn();
  const settings = createReminderSettings({ store, ...nodes, onRequest });
  return { ...nodes, store, onRequest, settings };
}

describe('reminder settings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('offers the enable button while the permission can still be asked for', () => {
    const { enableButton, status, onRequest } = setup(fakeNotifications('default'));
    expect(enableButton.hidden).toBe(false);
    expect(status.textContent).toContain('Разрешение не запрошено');

    enableButton.click();
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('hides the enable button when the browser has no Notification API', () => {
    const { enableButton, status, onRequest } = setup(null);
    expect(enableButton.hidden).toBe(true);
    expect(status.textContent).toBe('Браузер не умеет показывать уведомления.');

    // The click must not reach the request handler that would only toast.
    enableButton.click();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('hides the enable button once the permission was granted or refused', () => {
    expect(setup(fakeNotifications('granted')).enableButton.hidden).toBe(true);
    expect(setup(fakeNotifications('denied')).enableButton.hidden).toBe(true);
  });

  it('says there is nothing to remind about before any is set', () => {
    const { list } = setup(fakeNotifications('granted'));
    expect(list.textContent).toContain('Напоминаний пока нет');
  });
});
