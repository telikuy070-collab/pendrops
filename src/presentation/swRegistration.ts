/**
 * Service Worker Registration - Handles SW lifecycle and updates
 */
export async function registerSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    
    // Check for updates on load
    registration.update().catch(() => {});

    // Handle SW updates
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    // Listen for schedule updates from SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.type === 'schedule-updated') {
        // Dispatch custom event for app to handle
        window.dispatchEvent(new CustomEvent('schedule-updated', { 
          detail: { version: data.version, updated: data.updated } 
        }));
      }
    });

    // Periodic background sync fallback (if not supported)
    if (navigator.serviceWorker.controller) {
      setInterval(() => {
        navigator.serviceWorker.controller?.postMessage({ type: 'check-schedule' });
      }, 5 * 60 * 1000);
    }

    console.log('[SW] Registered:', registration.scope);
  } catch (err) {
    console.error('[SW] Registration failed:', err);
  }
}

/** Request periodic background sync permission */
export async function requestPeriodicSync(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('periodicSync' in ServiceWorkerRegistration.prototype)) return;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as any });
    if (status.state === 'granted') {
      await (registration as any).periodicSync.register('check-schedule', { minInterval: 5 * 60 * 1000 });
    }
  } catch {
    // Ignore - fallback to client-side polling
  }
}