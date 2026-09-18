import.meta.env = {"BASE_URL": "/", "DEV": true, "MODE": "development", "PROD": false, "SSR": false, "VITE_SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuemNmaHRtenZ4eGl3ZmtkcnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MTAzNzgsImV4cCI6MjEwNDI4NjM3OH0.aGrhaK5G7rM-p_bMDUZyGm-uvWSosvpe7GjfuWHXHX8", "VITE_SUPABASE_URL": "https://bnzcfhtmzvxxiwfkdryn.supabase.co"};/**
* Application Composition Root - Wires all layers together
* Single entry point, sets up DI, starts the app
*/
import { ScheduleService } from "/src/core/application/services/index.ts";
import { PreferencesService } from "/src/core/application/services/index.ts";
import { AuthService } from "/src/core/application/services/index.ts";
import { AdminService } from "/src/core/application/services/index.ts";
import { SupabaseScheduleRepository } from "/src/infrastructure/supabase/repository.ts";
import { SupabaseAuthProvider } from "/src/infrastructure/supabase/auth.ts";
import { HybridStorage } from "/src/infrastructure/storage/hybrid.ts";
import { ExcelFileParser } from "/src/infrastructure/github/parser.ts";
import { appStore, actions, filteredLessons } from "/src/presentation/stores/appStore.ts";
import { createToast } from "/src/view/toast.js";
import { createScheduleView } from "/src/view/scheduleView.js";
import { createAdminView } from "/src/view/adminView.js";
import { initBrandGesture } from "/src/presentation/gestures/brandGesture.ts";
import { escapeHtml } from "/src/text.js";
import { todayName } from "/src/presentation/stores/appStore.ts";
// Force Supabase bundle inclusion - call getSupabaseClient to trigger side effects
import { getSupabaseClient } from "/src/infrastructure/supabase/client.ts";
getSupabaseClient();
/** Initialize all services and start the app */
export async function bootstrap() {
	// Infrastructure
	const repository = new SupabaseScheduleRepository();
	const auth = new SupabaseAuthProvider();
	const storage = new HybridStorage();
	const parser = new ExcelFileParser();
	// Application Services
	const scheduleService = new ScheduleService(repository, storage);
	const prefsService = new PreferencesService(storage);
	const authService = new AuthService(auth);
	const adminService = new AdminService(repository, parser);
	// Register Service Worker FIRST (required for beforeinstallprompt)
	registerServiceWorker();
	// Initialize UI FIRST (so toast exists before any async callbacks)
	initializeUI(scheduleService, prefsService, authService, adminService);
	// Load initial data
	actions.setLoading(true);
	try {
		// Load preferences first
		const prefs = await prefsService.load();
		actions.setPreference("currentSheetId", prefs.currentSheetId);
		actions.setPreference("currentGroup", prefs.currentGroup);
		actions.setPreference("activeSubgroup", prefs.activeSubgroup);
		// Load schedule (instant from cache, then fresh from DB)
		const schedule = await scheduleService.load();
		actions.setSchedule(schedule);
		// Subscribe to realtime updates
		let initialLoad = true;
		const unsubscribe = scheduleService.subscribe((data) => {
			actions.setSchedule(data);
			// Show toast for updates (but not initial load)
			if (!initialLoad) {
				toast?.show("Расписание обновлено", "ok");
			}
			initialLoad = false;
		});
		// Store unsubscribe for cleanup
		window.__unsubscribeSchedule = unsubscribe;
		// Check for updates periodically
		startUpdateChecker(scheduleService);
	} catch (err) {
		console.error("[App] Bootstrap failed:", err);
		actions.setError("Не удалось загрузить расписание");
	} finally {
		actions.setLoading(false);
	}
	let toast;
	function initializeUI(scheduleService, prefsService, authService, adminService) {
		// Get DOM elements
		const container = document.getElementById("scheduleContainer");
		const toastEl = document.getElementById("toast");
		toast = createToast(toastEl);
		window.toast = toast;
		// Initialize schedule view
		const scheduleView = createScheduleView(container);
		// Create admin view for brand gesture
		const adminView = createAdminView(authService, adminService, toast);
		// Cache pill value elements
		const sheetValue = document.getElementById("sheetValue");
		const groupValue = document.getElementById("groupValue");
		const subgroupValue = document.getElementById("subgroupValue");
		const quickPick = document.getElementById("quickPick");
		// Bind store to view
		appStore.subscribe((state) => {
			console.log("[ui] subscribe triggered, prefs:", state.preferences);
			console.log("[ui] filtered lessons:", filteredLessons.value?.length);
			if (state.schedule) {
				scheduleView.render(filteredLessons.value, { today: state.ui.loading ? "" : todayName.value });
				// Show quickPick selectors when schedule is loaded
				if (quickPick) quickPick.classList.remove("hidden");
			}
			// Update pill values
			if (sheetValue) sheetValue.textContent = state.preferences.currentSheetId || "—";
			if (groupValue) groupValue.textContent = state.preferences.currentGroup || "—";
			if (subgroupValue) subgroupValue.textContent = state.preferences.activeSubgroup || "Все";
			// Show/hide modals based on activeModal state
			const modals = [
				"sheetModal",
				"groupModal",
				"subgroupModal",
				"settingsModal"
			];
			modals.forEach((id) => {
				const el = document.getElementById(id);
				if (el) {
					const shouldShow = state.ui.activeModal === id.replace("Modal", "");
					el.classList.toggle("hidden", !shouldShow);
				}
			});
		});
		// Initialize brand gesture (10-tap for admin)
		initBrandGesture({
			authService,
			adminView,
			toast
		});
		// Bind UI events
		bindEvents(scheduleService, prefsService, authService, adminService);
	}
	function bindEvents(scheduleService, prefsService, authService, adminService) {
		// Settings modal
		const settingsBtn = document.getElementById("settingsBtn");
		const settingsModal = document.getElementById("settingsModal");
		const closeModal = document.getElementById("closeModal");
		settingsBtn?.addEventListener("click", () => actions.openModal("settings"));
		closeModal?.addEventListener("click", () => actions.closeModal());
		settingsModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => actions.closeModal());
		// Sheet picker
		const sheetBtn = document.getElementById("sheetBtn");
		const sheetModal = document.getElementById("sheetModal");
		const sheetList = document.getElementById("sheetList");
		sheetBtn?.addEventListener("click", () => {
			renderSheetPicker(prefsService);
			actions.openModal("sheet");
		});
		sheetModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => actions.closeModal());
		sheetModal?.querySelector("[data-close=\"sheet\"]")?.addEventListener("click", () => actions.closeModal());
		// Group picker
		const groupBtn = document.getElementById("groupBtn");
		const groupModal = document.getElementById("groupModal");
		const groupList = document.getElementById("groupList");
		groupBtn?.addEventListener("click", () => {
			renderGroupPicker(prefsService);
			actions.openModal("group");
		});
		groupModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => actions.closeModal());
		groupModal?.querySelector("[data-close=\"group\"]")?.addEventListener("click", () => actions.closeModal());
		// Subgroup picker
		const subgroupBtn = document.getElementById("subgroupBtn");
		const subgroupModal = document.getElementById("subgroupModal");
		const subgroupList = document.getElementById("subgroupList");
		subgroupBtn?.addEventListener("click", () => {
			renderSubgroupPicker(prefsService);
			actions.openModal("subgroup");
		});
		subgroupModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => actions.closeModal());
		subgroupModal?.querySelector("[data-close=\"subgroup\"]")?.addEventListener("click", () => actions.closeModal());
		// Search and day filter
		const searchInput = document.getElementById("searchInput");
		const dayFilter = document.getElementById("dayFilter");
		const resetBtn = document.getElementById("resetBtn");
		searchInput?.addEventListener("input", (e) => actions.setFilter("search", e.target.value));
		dayFilter?.addEventListener("change", (e) => actions.setFilter("day", e.target.value));
		resetBtn?.addEventListener("click", () => {
			if (searchInput) searchInput.value = "";
			if (dayFilter) dayFilter.value = "";
			actions.resetFilters();
		});
		// Pull to refresh
		const scheduleContainer = document.getElementById("scheduleContainer");
		let pullStart = 0;
		scheduleContainer?.addEventListener("touchstart", (e) => {
			if (e.target.closest(".card")) return;
			const touch = e.touches[0];
			if (touch) pullStart = touch.clientY;
		}, { passive: true });
		scheduleContainer?.addEventListener("touchmove", (e) => {
			if (pullStart === 0 || !scheduleContainer) return;
			const touch = e.touches[0];
			if (!touch) return;
			const delta = touch.clientY - pullStart;
			if (delta > 100 && scheduleContainer.scrollTop === 0) {
				handlePullRefresh(scheduleService);
				pullStart = 0;
			}
		}, { passive: true });
	}
	function renderSheetPicker(prefsService) {
		const sheetList = document.getElementById("sheetList");
		const sched = appStore.get("schedule").value;
		if (!sched || !sheetList) return;
		sheetList.innerHTML = sched.sheetsMeta.map((sheet) => {
			const count = sched.sheets.get(sheet.id)?.length || 0;
			const active = sheet.id === appStore.get("preferences").value.currentSheetId;
			return `<button class="picker-item ${active ? "active" : ""}" data-sheet="${escapeHtml(sheet.id)}">
      <span>${escapeHtml(sheet.name)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? "запись" : "записей"}</span>
    </button>`;
		}).join("");
		sheetList.querySelectorAll(".picker-item").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const sheetId = btn.dataset.sheet;
				console.log("[picker] sheet selected:", sheetId);
				actions.setPreference("currentSheetId", sheetId);
				actions.setPreference("currentGroup", "");
				actions.setPreference("activeSubgroup", "");
				await prefsService.save({
					currentSheetId: sheetId,
					currentGroup: "",
					activeSubgroup: ""
				});
				actions.closeModal();
			});
		});
	}
	function renderGroupPicker(prefsService) {
		const groupList = document.getElementById("groupList");
		const sched = appStore.get("schedule").value;
		const prefs = appStore.get("preferences").value;
		if (!sched || !groupList || !prefs.currentSheetId) return;
		const groups = Array.from(sched.groups.values()).filter((g) => g.sheetId === prefs.currentSheetId);
		groupList.innerHTML = groups.map((group) => {
			const active = group.code === prefs.currentGroup;
			return `<button class="picker-item ${active ? "active" : ""}" data-group="${escapeHtml(group.code)}">
      <span>${escapeHtml(group.code)}</span>
      <span class="picker-item-meta">${group.lessonCount} ${group.lessonCount === 1 ? "пара" : "пар"}</span>
    </button>`;
		}).join("");
		groupList.querySelectorAll(".picker-item").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const groupCode = btn.dataset.group;
				console.log("[picker] group selected:", groupCode);
				actions.setPreference("currentGroup", groupCode);
				actions.setPreference("activeSubgroup", "");
				await prefsService.save({
					currentGroup: groupCode,
					activeSubgroup: ""
				});
				actions.closeModal();
			});
		});
	}
	function renderSubgroupPicker(prefsService) {
		const subgroupList = document.getElementById("subgroupList");
		const sched = appStore.get("schedule").value;
		const prefs = appStore.get("preferences").value;
		if (!sched || !subgroupList || !prefs.currentGroup) return;
		const lessons = sched.sheets.get(prefs.currentSheetId) || [];
		const groupLessons = lessons.filter((l) => l.group === prefs.currentGroup);
		const subgroups = Array.from(new Set(groupLessons.map((l) => l.subgroup).filter(Boolean))).sort((a, b) => {
			const na = Number(a), nb = Number(b);
			if (!isNaN(na) && !isNaN(nb)) return na - nb;
			return String(a).localeCompare(String(b), "ru");
		});
		if (subgroups.length === 0) {
			subgroupList.innerHTML = "<div class=\"picker-empty\">Нет подгрупп для этой группы</div>";
			return;
		}
		subgroupList.innerHTML = subgroups.map((sg) => {
			const count = groupLessons.filter((l) => l.subgroup === sg).length;
			const active = sg === prefs.activeSubgroup;
			return `<button class="picker-item ${active ? "active" : ""}" data-subgroup="${escapeHtml(sg)}">
      <span>${escapeHtml(sg)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? "пара" : "пар"}</span>
    </button>`;
		}).join("");
		subgroupList.querySelectorAll(".picker-item").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const subgroup = btn.dataset.subgroup;
				console.log("[picker] subgroup selected:", subgroup);
				actions.setPreference("activeSubgroup", subgroup);
				await prefsService.save({ activeSubgroup: subgroup });
				actions.closeModal();
			});
		});
	}
	async function handlePullRefresh(scheduleService) {
		toast?.show("Проверяю обновления...", "ok");
		const currentVersion = appStore.get("schedule").value?.version || "";
		const { hasUpdate } = await scheduleService.checkUpdates(currentVersion);
		if (hasUpdate) {
			const schedule = await scheduleService.load();
			actions.setSchedule(schedule);
			toast?.show("Расписание обновлено", "ok");
		} else {
			toast?.show("Обновлений нет", "ok");
		}
	}
	function startUpdateChecker(scheduleService) {
		// Check on visibility change
		document.addEventListener("visibilitychange", async () => {
			if (document.visibilityState === "visible") {
				const currentVersion = appStore.get("schedule").value?.version || "";
				const { hasUpdate, version, updatedAt } = await scheduleService.checkUpdates(currentVersion);
				if (hasUpdate) {
					actions.setUpdateAvailable({
						version,
						updatedAt
					});
				}
			}
		});
		// Periodic check every 5 minutes
		setInterval(async () => {
			const currentVersion = appStore.get("schedule").value?.version || "";
			const { hasUpdate, version, updatedAt } = await scheduleService.checkUpdates(currentVersion);
			if (hasUpdate) {
				actions.setUpdateAvailable({
					version,
					updatedAt
				});
			}
		}, 5 * 60 * 1e3);
	}
	// Start the app
	bootstrap().catch((err) => {
		console.error("[App] Fatal error:", err);
		document.body.innerHTML = "<div style=\"padding:2rem;text-align:center\">Ошибка инициализации приложения</div>";
	});
}
/**
* Register Service Worker for PWA functionality.
* Required for beforeinstallprompt to fire on Chrome Android.
*/
function registerServiceWorker() {
	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((reg) => {
			if (import.meta.env.DEV) {
				console.log("[SW] Registered:", reg.scope);
			}
		}).catch((err) => {
			console.error("[SW] Registration failed:", err);
		});
	}
}
/**
* Handle beforeinstallprompt for PWA install button.
* Shows the install button when the event fires.
*/
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
	const promptEvent = e;
	promptEvent.preventDefault();
	deferredPrompt = promptEvent;
	const btn = document.getElementById("installBtn");
	if (btn) btn.classList.remove("hidden");
});
const installBtn = document.getElementById("installBtn");
if (installBtn) {
	installBtn.addEventListener("click", async () => {
		if (!deferredPrompt) {
			alert("Откройте меню браузера → Добавить на главный экран");
			return;
		}
		deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === "accepted") {
			installBtn.classList.add("hidden");
		}
		deferredPrompt = null;
	});
}

//# sourceMappingURL=data:application/json;base64,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QUFXLGlCQUFpQixTQUFTLFlBQVk7RUFDL0MsSUFBSSxDQUFDLGdCQUFnQjtHQUNuQixNQUFNLG9EQUFvRDtHQUMxRDtFQUNGO0VBQ0EsZUFBZSxPQUFPO0VBQ3RCLE1BQU0sRUFBRSxZQUFZLE1BQU0sZUFBZTtFQUN6QyxJQUFJLFlBQVksWUFBWTtHQUMxQixXQUFXLFVBQVUsSUFBSSxRQUFRO0VBQ25DO0VBQ0EsaUJBQWlCO0NBQ25CLENBQUM7QUFDSCIsIm5hbWVzIjpbXSwic291cmNlcyI6WyJtYWluLnRzIl0sInZlcnNpb24iOjMsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBBcHBsaWNhdGlvbiBDb21wb3NpdGlvbiBSb290IC0gV2lyZXMgYWxsIGxheWVycyB0b2dldGhlclxyXG4gKiBTaW5nbGUgZW50cnkgcG9pbnQsIHNldHMgdXAgREksIHN0YXJ0cyB0aGUgYXBwXHJcbiAqL1xyXG5pbXBvcnQgeyBTY2hlZHVsZVNlcnZpY2UgfSBmcm9tICdAY29yZS9hcHBsaWNhdGlvbi9zZXJ2aWNlcyc7XHJcbmltcG9ydCB7IFByZWZlcmVuY2VzU2VydmljZSB9IGZyb20gJ0Bjb3JlL2FwcGxpY2F0aW9uL3NlcnZpY2VzJztcclxuaW1wb3J0IHsgQXV0aFNlcnZpY2UgfSBmcm9tICdAY29yZS9hcHBsaWNhdGlvbi9zZXJ2aWNlcyc7XHJcbmltcG9ydCB7IEFkbWluU2VydmljZSB9IGZyb20gJ0Bjb3JlL2FwcGxpY2F0aW9uL3NlcnZpY2VzJztcclxuaW1wb3J0IHsgU3VwYWJhc2VTY2hlZHVsZVJlcG9zaXRvcnkgfSBmcm9tICdAaW5mcmFzdHJ1Y3R1cmUvc3VwYWJhc2UvcmVwb3NpdG9yeSc7XHJcbmltcG9ydCB7IFN1cGFiYXNlQXV0aFByb3ZpZGVyIH0gZnJvbSAnQGluZnJhc3RydWN0dXJlL3N1cGFiYXNlL2F1dGgnO1xyXG5pbXBvcnQgeyBIeWJyaWRTdG9yYWdlIH0gZnJvbSAnQGluZnJhc3RydWN0dXJlL3N0b3JhZ2UvaHlicmlkJztcclxuaW1wb3J0IHsgRXhjZWxGaWxlUGFyc2VyIH0gZnJvbSAnQGluZnJhc3RydWN0dXJlL2dpdGh1Yi9wYXJzZXInO1xyXG5pbXBvcnQgeyBhcHBTdG9yZSwgYWN0aW9ucywgZmlsdGVyZWRMZXNzb25zIH0gZnJvbSAnQHByZXNlbnRhdGlvbi9zdG9yZXMvYXBwU3RvcmUnO1xyXG5pbXBvcnQgeyBjcmVhdGVUb2FzdCB9IGZyb20gJy4vdmlldy90b2FzdC5qcyc7XHJcbmltcG9ydCB7IGNyZWF0ZVNjaGVkdWxlVmlldyB9IGZyb20gJy4vdmlldy9zY2hlZHVsZVZpZXcuanMnO1xyXG5pbXBvcnQgeyBjcmVhdGVBZG1pblZpZXcgfSBmcm9tICcuL3ZpZXcvYWRtaW5WaWV3LmpzJztcclxuaW1wb3J0IHsgaW5pdEJyYW5kR2VzdHVyZSB9IGZyb20gJ0BwcmVzZW50YXRpb24vZ2VzdHVyZXMvYnJhbmRHZXN0dXJlJztcclxuaW1wb3J0IHsgZXNjYXBlSHRtbCB9IGZyb20gJy4vdGV4dC5qcyc7XHJcbmltcG9ydCB7IHRvZGF5TmFtZSB9IGZyb20gJ0BwcmVzZW50YXRpb24vc3RvcmVzL2FwcFN0b3JlJztcclxuaW1wb3J0IHR5cGUgeyBQcmVmZXJlbmNlc1NlcnZpY2UgYXMgUHJlZnNTZXJ2aWNlVHlwZSB9IGZyb20gJ0Bjb3JlL2FwcGxpY2F0aW9uL3NlcnZpY2VzJztcclxuaW1wb3J0IHsgcmVwb3J0RXJyb3IgfSBmcm9tICcuL3ZpZXcvZXJyb3JCb3VuZGFyeS5qcyc7XHJcbi8vIEZvcmNlIFN1cGFiYXNlIGJ1bmRsZSBpbmNsdXNpb24gLSBjYWxsIGdldFN1cGFiYXNlQ2xpZW50IHRvIHRyaWdnZXIgc2lkZSBlZmZlY3RzXHJcbmltcG9ydCB7IGdldFN1cGFiYXNlQ2xpZW50IH0gZnJvbSAnQGluZnJhc3RydWN0dXJlL3N1cGFiYXNlL2NsaWVudCc7XHJcbmdldFN1cGFiYXNlQ2xpZW50KCk7XHJcblxyXG4vKiogSW5pdGlhbGl6ZSBhbGwgc2VydmljZXMgYW5kIHN0YXJ0IHRoZSBhcHAgKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJvb3RzdHJhcCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAvLyBJbmZyYXN0cnVjdHVyZVxyXG4gIGNvbnN0IHJlcG9zaXRvcnkgPSBuZXcgU3VwYWJhc2VTY2hlZHVsZVJlcG9zaXRvcnkoKTtcclxuICBjb25zdCBhdXRoID0gbmV3IFN1cGFiYXNlQXV0aFByb3ZpZGVyKCk7XHJcbiAgY29uc3Qgc3RvcmFnZSA9IG5ldyBIeWJyaWRTdG9yYWdlKCk7XHJcbiAgY29uc3QgcGFyc2VyID0gbmV3IEV4Y2VsRmlsZVBhcnNlcigpO1xyXG5cclxuICAvLyBBcHBsaWNhdGlvbiBTZXJ2aWNlc1xyXG4gIGNvbnN0IHNjaGVkdWxlU2VydmljZSA9IG5ldyBTY2hlZHVsZVNlcnZpY2UocmVwb3NpdG9yeSwgc3RvcmFnZSk7XHJcbiAgY29uc3QgcHJlZnNTZXJ2aWNlID0gbmV3IFByZWZlcmVuY2VzU2VydmljZShzdG9yYWdlKTtcclxuICBjb25zdCBhdXRoU2VydmljZSA9IG5ldyBBdXRoU2VydmljZShhdXRoKTtcclxuICBjb25zdCBhZG1pblNlcnZpY2UgPSBuZXcgQWRtaW5TZXJ2aWNlKHJlcG9zaXRvcnksIHBhcnNlcik7XHJcblxyXG4gIC8vIFJlZ2lzdGVyIFNlcnZpY2UgV29ya2VyIEZJUlNUIChyZXF1aXJlZCBmb3IgYmVmb3JlaW5zdGFsbHByb21wdClcclxuICByZWdpc3RlclNlcnZpY2VXb3JrZXIoKTtcclxuXHJcbiAgLy8gSW5pdGlhbGl6ZSBVSSBGSVJTVCAoc28gdG9hc3QgZXhpc3RzIGJlZm9yZSBhbnkgYXN5bmMgY2FsbGJhY2tzKVxyXG4gIGluaXRpYWxpemVVSShzY2hlZHVsZVNlcnZpY2UsIHByZWZzU2VydmljZSwgYXV0aFNlcnZpY2UsIGFkbWluU2VydmljZSk7XHJcblxyXG4gIC8vIExvYWQgaW5pdGlhbCBkYXRhXHJcbiAgYWN0aW9ucy5zZXRMb2FkaW5nKHRydWUpO1xyXG5cclxuICB0cnkge1xyXG4gICAgLy8gTG9hZCBwcmVmZXJlbmNlcyBmaXJzdFxyXG4gICAgY29uc3QgcHJlZnMgPSBhd2FpdCBwcmVmc1NlcnZpY2UubG9hZCgpO1xyXG4gICAgYWN0aW9ucy5zZXRQcmVmZXJlbmNlKCdjdXJyZW50U2hlZXRJZCcsIHByZWZzLmN1cnJlbnRTaGVldElkKTtcclxuICAgIGFjdGlvbnMuc2V0UHJlZmVyZW5jZSgnY3VycmVudEdyb3VwJywgcHJlZnMuY3VycmVudEdyb3VwKTtcclxuICAgIGFjdGlvbnMuc2V0UHJlZmVyZW5jZSgnYWN0aXZlU3ViZ3JvdXAnLCBwcmVmcy5hY3RpdmVTdWJncm91cCk7XHJcblxyXG4gICAgLy8gTG9hZCBzY2hlZHVsZSAoaW5zdGFudCBmcm9tIGNhY2hlLCB0aGVuIGZyZXNoIGZyb20gREIpXHJcbiAgICBjb25zdCBzY2hlZHVsZSA9IGF3YWl0IHNjaGVkdWxlU2VydmljZS5sb2FkKCk7XHJcbiAgICBhY3Rpb25zLnNldFNjaGVkdWxlKHNjaGVkdWxlKTtcclxuXHJcbiAgICAvLyBTdWJzY3JpYmUgdG8gcmVhbHRpbWUgdXBkYXRlc1xyXG4gICAgbGV0IGluaXRpYWxMb2FkID0gdHJ1ZTtcclxuICAgIGNvbnN0IHVuc3Vic2NyaWJlID0gc2NoZWR1bGVTZXJ2aWNlLnN1YnNjcmliZSgoZGF0YSkgPT4ge1xyXG4gICAgICBhY3Rpb25zLnNldFNjaGVkdWxlKGRhdGEpO1xyXG4gICAgICAvLyBTaG93IHRvYXN0IGZvciB1cGRhdGVzIChidXQgbm90IGluaXRpYWwgbG9hZClcclxuICAgICAgaWYgKCFpbml0aWFsTG9hZCkge1xyXG4gICAgICAgIHRvYXN0Py5zaG93KCfQoNCw0YHQv9C40YHQsNC90LjQtSDQvtCx0L3QvtCy0LvQtdC90L4nLCAnb2snKTtcclxuICAgICAgfVxyXG4gICAgICBpbml0aWFsTG9hZCA9IGZhbHNlO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RvcmUgdW5zdWJzY3JpYmUgZm9yIGNsZWFudXBcclxuICAgICh3aW5kb3cgYXMgYW55KS5fX3Vuc3Vic2NyaWJlU2NoZWR1bGUgPSB1bnN1YnNjcmliZTtcclxuXHJcbiAgICAvLyBDaGVjayBmb3IgdXBkYXRlcyBwZXJpb2RpY2FsbHlcclxuICAgIHN0YXJ0VXBkYXRlQ2hlY2tlcihzY2hlZHVsZVNlcnZpY2UpO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgY29uc29sZS5lcnJvcignW0FwcF0gQm9vdHN0cmFwIGZhaWxlZDonLCBlcnIpO1xyXG4gICAgYWN0aW9ucy5zZXRFcnJvcign0J3QtSDRg9C00LDQu9C+0YHRjCDQt9Cw0LPRgNGD0LfQuNGC0Ywg0YDQsNGB0L/QuNGB0LDQvdC40LUnKTtcclxuICB9IGZpbmFsbHkge1xyXG4gICAgYWN0aW9ucy5zZXRMb2FkaW5nKGZhbHNlKTtcclxuICB9XHJcblxyXG4gIGxldCB0b2FzdDogUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlVG9hc3Q+O1xyXG5cclxuICBmdW5jdGlvbiBpbml0aWFsaXplVUkoXHJcbiAgICBzY2hlZHVsZVNlcnZpY2U6IFNjaGVkdWxlU2VydmljZSxcclxuICAgIHByZWZzU2VydmljZTogUHJlZnNTZXJ2aWNlVHlwZSxcclxuICAgIGF1dGhTZXJ2aWNlOiBBdXRoU2VydmljZSxcclxuICAgIGFkbWluU2VydmljZTogQWRtaW5TZXJ2aWNlXHJcbiAgKTogdm9pZCB7XHJcbiAgICAvLyBHZXQgRE9NIGVsZW1lbnRzXHJcbiAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2NoZWR1bGVDb250YWluZXInKTtcclxuICAgIGNvbnN0IHRvYXN0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9hc3QnKTtcclxuXHJcbiAgICB0b2FzdCA9IGNyZWF0ZVRvYXN0KHRvYXN0RWwpO1xyXG4gICAgKHdpbmRvdyBhcyBhbnkpLnRvYXN0ID0gdG9hc3Q7XHJcblxyXG4gICAgLy8gSW5pdGlhbGl6ZSBzY2hlZHVsZSB2aWV3XHJcbiAgICBjb25zdCBzY2hlZHVsZVZpZXcgPSBjcmVhdGVTY2hlZHVsZVZpZXcoY29udGFpbmVyKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYWRtaW4gdmlldyBmb3IgYnJhbmQgZ2VzdHVyZVxyXG4gICAgY29uc3QgYWRtaW5WaWV3ID0gY3JlYXRlQWRtaW5WaWV3KGF1dGhTZXJ2aWNlLCBhZG1pblNlcnZpY2UsIHRvYXN0KTtcclxuXHJcbiAgICAvLyBDYWNoZSBwaWxsIHZhbHVlIGVsZW1lbnRzXHJcbiAgICBjb25zdCBzaGVldFZhbHVlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0VmFsdWUnKTtcclxuICAgIGNvbnN0IGdyb3VwVmFsdWUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ3JvdXBWYWx1ZScpO1xyXG4gICAgY29uc3Qgc3ViZ3JvdXBWYWx1ZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdWJncm91cFZhbHVlJyk7XHJcbiAgICBjb25zdCBxdWlja1BpY2sgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncXVpY2tQaWNrJyk7XHJcblxyXG4gICAgLy8gQmluZCBzdG9yZSB0byB2aWV3XHJcbiAgICBhcHBTdG9yZS5zdWJzY3JpYmUoKHN0YXRlKSA9PiB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbdWldIHN1YnNjcmliZSB0cmlnZ2VyZWQsIHByZWZzOicsIHN0YXRlLnByZWZlcmVuY2VzKTtcclxuICAgICAgY29uc29sZS5sb2coJ1t1aV0gZmlsdGVyZWQgbGVzc29uczonLCBmaWx0ZXJlZExlc3NvbnMudmFsdWU/Lmxlbmd0aCk7XHJcblxyXG4gICAgICBpZiAoc3RhdGUuc2NoZWR1bGUpIHtcclxuICAgICAgICBzY2hlZHVsZVZpZXcucmVuZGVyKGZpbHRlcmVkTGVzc29ucy52YWx1ZSwge1xyXG4gICAgICAgICAgdG9kYXk6IHN0YXRlLnVpLmxvYWRpbmcgPyAnJyA6IHRvZGF5TmFtZS52YWx1ZSxcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBTaG93IHF1aWNrUGljayBzZWxlY3RvcnMgd2hlbiBzY2hlZHVsZSBpcyBsb2FkZWRcclxuICAgICAgICBpZiAocXVpY2tQaWNrKSBxdWlja1BpY2suY2xhc3NMaXN0LnJlbW92ZSgnaGlkZGVuJyk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gVXBkYXRlIHBpbGwgdmFsdWVzXHJcbiAgICAgIGlmIChzaGVldFZhbHVlKSBzaGVldFZhbHVlLnRleHRDb250ZW50ID0gc3RhdGUucHJlZmVyZW5jZXMuY3VycmVudFNoZWV0SWQgfHwgJ+KAlCc7XHJcbiAgICAgIGlmIChncm91cFZhbHVlKSBncm91cFZhbHVlLnRleHRDb250ZW50ID0gc3RhdGUucHJlZmVyZW5jZXMuY3VycmVudEdyb3VwIHx8ICfigJQnO1xyXG4gICAgICBpZiAoc3ViZ3JvdXBWYWx1ZSkgc3ViZ3JvdXBWYWx1ZS50ZXh0Q29udGVudCA9IHN0YXRlLnByZWZlcmVuY2VzLmFjdGl2ZVN1Ymdyb3VwIHx8ICfQktGB0LUnO1xyXG5cclxuICAgICAgLy8gU2hvdy9oaWRlIG1vZGFscyBiYXNlZCBvbiBhY3RpdmVNb2RhbCBzdGF0ZVxyXG4gICAgICBjb25zdCBtb2RhbHMgPSBbJ3NoZWV0TW9kYWwnLCAnZ3JvdXBNb2RhbCcsICdzdWJncm91cE1vZGFsJywgJ3NldHRpbmdzTW9kYWwnXTtcclxuICAgICAgbW9kYWxzLmZvckVhY2goKGlkKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XHJcbiAgICAgICAgaWYgKGVsKSB7XHJcbiAgICAgICAgICBjb25zdCBzaG91bGRTaG93ID0gc3RhdGUudWkuYWN0aXZlTW9kYWwgPT09IGlkLnJlcGxhY2UoJ01vZGFsJywgJycpO1xyXG4gICAgICAgICAgZWwuY2xhc3NMaXN0LnRvZ2dsZSgnaGlkZGVuJywgIXNob3VsZFNob3cpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbml0aWFsaXplIGJyYW5kIGdlc3R1cmUgKDEwLXRhcCBmb3IgYWRtaW4pXHJcbiAgICBpbml0QnJhbmRHZXN0dXJlKHsgYXV0aFNlcnZpY2UsIGFkbWluVmlldywgdG9hc3QgfSk7XHJcblxyXG4gICAgLy8gQmluZCBVSSBldmVudHNcclxuICAgIGJpbmRFdmVudHMoc2NoZWR1bGVTZXJ2aWNlLCBwcmVmc1NlcnZpY2UsIGF1dGhTZXJ2aWNlLCBhZG1pblNlcnZpY2UpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gYmluZEV2ZW50cyhcclxuICAgIHNjaGVkdWxlU2VydmljZTogU2NoZWR1bGVTZXJ2aWNlLFxyXG4gICAgcHJlZnNTZXJ2aWNlOiBQcmVmc1NlcnZpY2VUeXBlLFxyXG4gICAgYXV0aFNlcnZpY2U6IEF1dGhTZXJ2aWNlLFxyXG4gICAgYWRtaW5TZXJ2aWNlOiBBZG1pblNlcnZpY2VcclxuICApOiB2b2lkIHtcclxuICAgIC8vIFNldHRpbmdzIG1vZGFsXHJcbiAgICBjb25zdCBzZXR0aW5nc0J0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5nc0J0bicpO1xyXG4gICAgY29uc3Qgc2V0dGluZ3NNb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5nc01vZGFsJyk7XHJcbiAgICBjb25zdCBjbG9zZU1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Nsb3NlTW9kYWwnKTtcclxuXHJcbiAgICBzZXR0aW5nc0J0bj8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiBhY3Rpb25zLm9wZW5Nb2RhbCgnc2V0dGluZ3MnKSk7XHJcbiAgICBjbG9zZU1vZGFsPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IGFjdGlvbnMuY2xvc2VNb2RhbCgpKTtcclxuICAgIHNldHRpbmdzTW9kYWxcclxuICAgICAgPy5xdWVyeVNlbGVjdG9yKCcubW9kYWwtYmFja2Ryb3AnKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG5cclxuICAgIC8vIFNoZWV0IHBpY2tlclxyXG4gICAgY29uc3Qgc2hlZXRCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXRCdG4nKTtcclxuICAgIGNvbnN0IHNoZWV0TW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXRNb2RhbCcpO1xyXG4gICAgY29uc3Qgc2hlZXRMaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0TGlzdCcpO1xyXG5cclxuICAgIHNoZWV0QnRuPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgcmVuZGVyU2hlZXRQaWNrZXIocHJlZnNTZXJ2aWNlKTtcclxuICAgICAgYWN0aW9ucy5vcGVuTW9kYWwoJ3NoZWV0Jyk7XHJcbiAgICB9KTtcclxuICAgIHNoZWV0TW9kYWxcclxuICAgICAgPy5xdWVyeVNlbGVjdG9yKCcubW9kYWwtYmFja2Ryb3AnKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG4gICAgc2hlZXRNb2RhbFxyXG4gICAgICA/LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLWNsb3NlPVwic2hlZXRcIl0nKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG5cclxuICAgIC8vIEdyb3VwIHBpY2tlclxyXG4gICAgY29uc3QgZ3JvdXBCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ3JvdXBCdG4nKTtcclxuICAgIGNvbnN0IGdyb3VwTW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ3JvdXBNb2RhbCcpO1xyXG4gICAgY29uc3QgZ3JvdXBMaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dyb3VwTGlzdCcpO1xyXG5cclxuICAgIGdyb3VwQnRuPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgcmVuZGVyR3JvdXBQaWNrZXIocHJlZnNTZXJ2aWNlKTtcclxuICAgICAgYWN0aW9ucy5vcGVuTW9kYWwoJ2dyb3VwJyk7XHJcbiAgICB9KTtcclxuICAgIGdyb3VwTW9kYWxcclxuICAgICAgPy5xdWVyeVNlbGVjdG9yKCcubW9kYWwtYmFja2Ryb3AnKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG4gICAgZ3JvdXBNb2RhbFxyXG4gICAgICA/LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLWNsb3NlPVwiZ3JvdXBcIl0nKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG5cclxuICAgIC8vIFN1Ymdyb3VwIHBpY2tlclxyXG4gICAgY29uc3Qgc3ViZ3JvdXBCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3ViZ3JvdXBCdG4nKTtcclxuICAgIGNvbnN0IHN1Ymdyb3VwTW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3ViZ3JvdXBNb2RhbCcpO1xyXG4gICAgY29uc3Qgc3ViZ3JvdXBMaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N1Ymdyb3VwTGlzdCcpO1xyXG5cclxuICAgIHN1Ymdyb3VwQnRuPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgcmVuZGVyU3ViZ3JvdXBQaWNrZXIocHJlZnNTZXJ2aWNlKTtcclxuICAgICAgYWN0aW9ucy5vcGVuTW9kYWwoJ3N1Ymdyb3VwJyk7XHJcbiAgICB9KTtcclxuICAgIHN1Ymdyb3VwTW9kYWxcclxuICAgICAgPy5xdWVyeVNlbGVjdG9yKCcubW9kYWwtYmFja2Ryb3AnKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG4gICAgc3ViZ3JvdXBNb2RhbFxyXG4gICAgICA/LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLWNsb3NlPVwic3ViZ3JvdXBcIl0nKVxyXG4gICAgICA/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gYWN0aW9ucy5jbG9zZU1vZGFsKCkpO1xyXG5cclxuICAgIC8vIFNlYXJjaCBhbmQgZGF5IGZpbHRlclxyXG4gICAgY29uc3Qgc2VhcmNoSW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VhcmNoSW5wdXQnKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcclxuICAgIGNvbnN0IGRheUZpbHRlciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXlGaWx0ZXInKSBhcyBIVE1MU2VsZWN0RWxlbWVudCB8IG51bGw7XHJcbiAgICBjb25zdCByZXNldEJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXNldEJ0bicpO1xyXG5cclxuICAgIHNlYXJjaElucHV0Py5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsIChlKSA9PlxyXG4gICAgICBhY3Rpb25zLnNldEZpbHRlcignc2VhcmNoJywgKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlKVxyXG4gICAgKTtcclxuICAgIGRheUZpbHRlcj8uYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGUpID0+XHJcbiAgICAgIGFjdGlvbnMuc2V0RmlsdGVyKCdkYXknLCAoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKVxyXG4gICAgKTtcclxuICAgIHJlc2V0QnRuPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgaWYgKHNlYXJjaElucHV0KSBzZWFyY2hJbnB1dC52YWx1ZSA9ICcnO1xyXG4gICAgICBpZiAoZGF5RmlsdGVyKSBkYXlGaWx0ZXIudmFsdWUgPSAnJztcclxuICAgICAgYWN0aW9ucy5yZXNldEZpbHRlcnMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFB1bGwgdG8gcmVmcmVzaFxyXG4gICAgY29uc3Qgc2NoZWR1bGVDb250YWluZXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2NoZWR1bGVDb250YWluZXInKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICBsZXQgcHVsbFN0YXJ0ID0gMDtcclxuICAgIHNjaGVkdWxlQ29udGFpbmVyPy5hZGRFdmVudExpc3RlbmVyKFxyXG4gICAgICAndG91Y2hzdGFydCcsXHJcbiAgICAgIChlOiBUb3VjaEV2ZW50KSA9PiB7XHJcbiAgICAgICAgaWYgKChlLnRhcmdldCBhcyBIVE1MRWxlbWVudCkuY2xvc2VzdCgnLmNhcmQnKSkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IHRvdWNoID0gZS50b3VjaGVzWzBdO1xyXG4gICAgICAgIGlmICh0b3VjaCkgcHVsbFN0YXJ0ID0gdG91Y2guY2xpZW50WTtcclxuICAgICAgfSxcclxuICAgICAgeyBwYXNzaXZlOiB0cnVlIH1cclxuICAgICk7XHJcblxyXG4gICAgc2NoZWR1bGVDb250YWluZXI/LmFkZEV2ZW50TGlzdGVuZXIoXHJcbiAgICAgICd0b3VjaG1vdmUnLFxyXG4gICAgICAoZTogVG91Y2hFdmVudCkgPT4ge1xyXG4gICAgICAgIGlmIChwdWxsU3RhcnQgPT09IDAgfHwgIXNjaGVkdWxlQ29udGFpbmVyKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgdG91Y2ggPSBlLnRvdWNoZXNbMF07XHJcbiAgICAgICAgaWYgKCF0b3VjaCkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IGRlbHRhID0gdG91Y2guY2xpZW50WSAtIHB1bGxTdGFydDtcclxuICAgICAgICBpZiAoZGVsdGEgPiAxMDAgJiYgc2NoZWR1bGVDb250YWluZXIuc2Nyb2xsVG9wID09PSAwKSB7XHJcbiAgICAgICAgICBoYW5kbGVQdWxsUmVmcmVzaChzY2hlZHVsZVNlcnZpY2UpO1xyXG4gICAgICAgICAgcHVsbFN0YXJ0ID0gMDtcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHsgcGFzc2l2ZTogdHJ1ZSB9XHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVuZGVyU2hlZXRQaWNrZXIocHJlZnNTZXJ2aWNlOiBQcmVmc1NlcnZpY2VUeXBlKTogdm9pZCB7XHJcbiAgICBjb25zdCBzaGVldExpc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXRMaXN0Jyk7XHJcbiAgICBjb25zdCBzY2hlZCA9IGFwcFN0b3JlLmdldCgnc2NoZWR1bGUnKS52YWx1ZTtcclxuICAgIGlmICghc2NoZWQgfHwgIXNoZWV0TGlzdCkgcmV0dXJuO1xyXG5cclxuICAgIHNoZWV0TGlzdC5pbm5lckhUTUwgPSBzY2hlZC5zaGVldHNNZXRhXHJcbiAgICAgIC5tYXAoKHNoZWV0KSA9PiB7XHJcbiAgICAgICAgY29uc3QgY291bnQgPSBzY2hlZC5zaGVldHMuZ2V0KHNoZWV0LmlkKT8ubGVuZ3RoIHx8IDA7XHJcbiAgICAgICAgY29uc3QgYWN0aXZlID0gc2hlZXQuaWQgPT09IGFwcFN0b3JlLmdldCgncHJlZmVyZW5jZXMnKS52YWx1ZS5jdXJyZW50U2hlZXRJZDtcclxuICAgICAgICByZXR1cm4gYDxidXR0b24gY2xhc3M9XCJwaWNrZXItaXRlbSAke2FjdGl2ZSA/ICdhY3RpdmUnIDogJyd9XCIgZGF0YS1zaGVldD1cIiR7ZXNjYXBlSHRtbChzaGVldC5pZCl9XCI+XHJcbiAgICAgIDxzcGFuPiR7ZXNjYXBlSHRtbChzaGVldC5uYW1lKX08L3NwYW4+XHJcbiAgICAgIDxzcGFuIGNsYXNzPVwicGlja2VyLWl0ZW0tbWV0YVwiPiR7Y291bnR9ICR7Y291bnQgPT09IDEgPyAn0LfQsNC/0LjRgdGMJyA6ICfQt9Cw0L/QuNGB0LXQuSd9PC9zcGFuPlxyXG4gICAgPC9idXR0b24+YDtcclxuICAgICAgfSlcclxuICAgICAgLmpvaW4oJycpO1xyXG5cclxuICAgIHNoZWV0TGlzdC5xdWVyeVNlbGVjdG9yQWxsKCcucGlja2VyLWl0ZW0nKS5mb3JFYWNoKChidG4pID0+IHtcclxuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHNoZWV0SWQgPSAoYnRuIGFzIEhUTUxFbGVtZW50KS5kYXRhc2V0LnNoZWV0ITtcclxuICAgICAgICBjb25zb2xlLmxvZygnW3BpY2tlcl0gc2hlZXQgc2VsZWN0ZWQ6Jywgc2hlZXRJZCk7XHJcbiAgICAgICAgYWN0aW9ucy5zZXRQcmVmZXJlbmNlKCdjdXJyZW50U2hlZXRJZCcsIHNoZWV0SWQpO1xyXG4gICAgICAgIGFjdGlvbnMuc2V0UHJlZmVyZW5jZSgnY3VycmVudEdyb3VwJywgJycpO1xyXG4gICAgICAgIGFjdGlvbnMuc2V0UHJlZmVyZW5jZSgnYWN0aXZlU3ViZ3JvdXAnLCAnJyk7XHJcbiAgICAgICAgYXdhaXQgcHJlZnNTZXJ2aWNlLnNhdmUoeyBjdXJyZW50U2hlZXRJZDogc2hlZXRJZCwgY3VycmVudEdyb3VwOiAnJywgYWN0aXZlU3ViZ3JvdXA6ICcnIH0pO1xyXG4gICAgICAgIGFjdGlvbnMuY2xvc2VNb2RhbCgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVuZGVyR3JvdXBQaWNrZXIocHJlZnNTZXJ2aWNlOiBQcmVmc1NlcnZpY2VUeXBlKTogdm9pZCB7XHJcbiAgICBjb25zdCBncm91cExpc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ3JvdXBMaXN0Jyk7XHJcbiAgICBjb25zdCBzY2hlZCA9IGFwcFN0b3JlLmdldCgnc2NoZWR1bGUnKS52YWx1ZTtcclxuICAgIGNvbnN0IHByZWZzID0gYXBwU3RvcmUuZ2V0KCdwcmVmZXJlbmNlcycpLnZhbHVlO1xyXG4gICAgaWYgKCFzY2hlZCB8fCAhZ3JvdXBMaXN0IHx8ICFwcmVmcy5jdXJyZW50U2hlZXRJZCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGdyb3VwcyA9IEFycmF5LmZyb20oc2NoZWQuZ3JvdXBzLnZhbHVlcygpKS5maWx0ZXIoXHJcbiAgICAgIChnKSA9PiBnLnNoZWV0SWQgPT09IHByZWZzLmN1cnJlbnRTaGVldElkXHJcbiAgICApO1xyXG5cclxuICAgIGdyb3VwTGlzdC5pbm5lckhUTUwgPSBncm91cHNcclxuICAgICAgLm1hcCgoZ3JvdXApID0+IHtcclxuICAgICAgICBjb25zdCBhY3RpdmUgPSBncm91cC5jb2RlID09PSBwcmVmcy5jdXJyZW50R3JvdXA7XHJcbiAgICAgICAgcmV0dXJuIGA8YnV0dG9uIGNsYXNzPVwicGlja2VyLWl0ZW0gJHthY3RpdmUgPyAnYWN0aXZlJyA6ICcnfVwiIGRhdGEtZ3JvdXA9XCIke2VzY2FwZUh0bWwoZ3JvdXAuY29kZSl9XCI+XHJcbiAgICAgIDxzcGFuPiR7ZXNjYXBlSHRtbChncm91cC5jb2RlKX08L3NwYW4+XHJcbiAgICAgIDxzcGFuIGNsYXNzPVwicGlja2VyLWl0ZW0tbWV0YVwiPiR7Z3JvdXAubGVzc29uQ291bnR9ICR7Z3JvdXAubGVzc29uQ291bnQgPT09IDEgPyAn0L/QsNGA0LAnIDogJ9C/0LDRgCd9PC9zcGFuPlxyXG4gICAgPC9idXR0b24+YDtcclxuICAgICAgfSlcclxuICAgICAgLmpvaW4oJycpO1xyXG5cclxuICAgIGdyb3VwTGlzdC5xdWVyeVNlbGVjdG9yQWxsKCcucGlja2VyLWl0ZW0nKS5mb3JFYWNoKChidG4pID0+IHtcclxuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGdyb3VwQ29kZSA9IChidG4gYXMgSFRNTEVsZW1lbnQpLmRhdGFzZXQuZ3JvdXAhO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbcGlja2VyXSBncm91cCBzZWxlY3RlZDonLCBncm91cENvZGUpO1xyXG4gICAgICAgIGFjdGlvbnMuc2V0UHJlZmVyZW5jZSgnY3VycmVudEdyb3VwJywgZ3JvdXBDb2RlKTtcclxuICAgICAgICBhY3Rpb25zLnNldFByZWZlcmVuY2UoJ2FjdGl2ZVN1Ymdyb3VwJywgJycpO1xyXG4gICAgICAgIGF3YWl0IHByZWZzU2VydmljZS5zYXZlKHsgY3VycmVudEdyb3VwOiBncm91cENvZGUsIGFjdGl2ZVN1Ymdyb3VwOiAnJyB9KTtcclxuICAgICAgICBhY3Rpb25zLmNsb3NlTW9kYWwoKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlbmRlclN1Ymdyb3VwUGlja2VyKHByZWZzU2VydmljZTogUHJlZnNTZXJ2aWNlVHlwZSk6IHZvaWQge1xyXG4gICAgY29uc3Qgc3ViZ3JvdXBMaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N1Ymdyb3VwTGlzdCcpO1xyXG4gICAgY29uc3Qgc2NoZWQgPSBhcHBTdG9yZS5nZXQoJ3NjaGVkdWxlJykudmFsdWU7XHJcbiAgICBjb25zdCBwcmVmcyA9IGFwcFN0b3JlLmdldCgncHJlZmVyZW5jZXMnKS52YWx1ZTtcclxuICAgIGlmICghc2NoZWQgfHwgIXN1Ymdyb3VwTGlzdCB8fCAhcHJlZnMuY3VycmVudEdyb3VwKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgbGVzc29ucyA9IHNjaGVkLnNoZWV0cy5nZXQocHJlZnMuY3VycmVudFNoZWV0SWQhKSB8fCBbXTtcclxuICAgIGNvbnN0IGdyb3VwTGVzc29ucyA9IGxlc3NvbnMuZmlsdGVyKChsKSA9PiBsLmdyb3VwID09PSBwcmVmcy5jdXJyZW50R3JvdXApO1xyXG4gICAgY29uc3Qgc3ViZ3JvdXBzID0gQXJyYXkuZnJvbShuZXcgU2V0KGdyb3VwTGVzc29ucy5tYXAoKGwpID0+IGwuc3ViZ3JvdXApLmZpbHRlcihCb29sZWFuKSkpLnNvcnQoXHJcbiAgICAgIChhLCBiKSA9PiB7XHJcbiAgICAgICAgY29uc3QgbmEgPSBOdW1iZXIoYSksXHJcbiAgICAgICAgICBuYiA9IE51bWJlcihiKTtcclxuICAgICAgICBpZiAoIWlzTmFOKG5hKSAmJiAhaXNOYU4obmIpKSByZXR1cm4gbmEgLSBuYjtcclxuICAgICAgICByZXR1cm4gU3RyaW5nKGEpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIpLCAncnUnKTtcclxuICAgICAgfVxyXG4gICAgKTtcclxuXHJcbiAgICBpZiAoc3ViZ3JvdXBzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBzdWJncm91cExpc3QuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJwaWNrZXItZW1wdHlcIj7QndC10YIg0L/QvtC00LPRgNGD0L/QvyDQtNC70Y8g0Y3RgtC+0Lkg0LPRgNGD0L/Qv9GLPC9kaXY+JztcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHN1Ymdyb3VwTGlzdC5pbm5lckhUTUwgPSBzdWJncm91cHNcclxuICAgICAgLm1hcCgoc2cpID0+IHtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGdyb3VwTGVzc29ucy5maWx0ZXIoKGwpID0+IGwuc3ViZ3JvdXAgPT09IHNnKS5sZW5ndGg7XHJcbiAgICAgICAgY29uc3QgYWN0aXZlID0gc2cgPT09IHByZWZzLmFjdGl2ZVN1Ymdyb3VwO1xyXG4gICAgICAgIHJldHVybiBgPGJ1dHRvbiBjbGFzcz1cInBpY2tlci1pdGVtICR7YWN0aXZlID8gJ2FjdGl2ZScgOiAnJ31cIiBkYXRhLXN1Ymdyb3VwPVwiJHtlc2NhcGVIdG1sKHNnKX1cIj5cclxuICAgICAgPHNwYW4+JHtlc2NhcGVIdG1sKHNnKX08L3NwYW4+XHJcbiAgICAgIDxzcGFuIGNsYXNzPVwicGlja2VyLWl0ZW0tbWV0YVwiPiR7Y291bnR9ICR7Y291bnQgPT09IDEgPyAn0L/QsNGA0LAnIDogJ9C/0LDRgCd9PC9zcGFuPlxyXG4gICAgPC9idXR0b24+YDtcclxuICAgICAgfSlcclxuICAgICAgLmpvaW4oJycpO1xyXG5cclxuICAgIHN1Ymdyb3VwTGlzdC5xdWVyeVNlbGVjdG9yQWxsKCcucGlja2VyLWl0ZW0nKS5mb3JFYWNoKChidG4pID0+IHtcclxuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHN1Ymdyb3VwID0gKGJ0biBhcyBIVE1MRWxlbWVudCkuZGF0YXNldC5zdWJncm91cCE7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1twaWNrZXJdIHN1Ymdyb3VwIHNlbGVjdGVkOicsIHN1Ymdyb3VwKTtcclxuICAgICAgICBhY3Rpb25zLnNldFByZWZlcmVuY2UoJ2FjdGl2ZVN1Ymdyb3VwJywgc3ViZ3JvdXApO1xyXG4gICAgICAgIGF3YWl0IHByZWZzU2VydmljZS5zYXZlKHsgYWN0aXZlU3ViZ3JvdXA6IHN1Ymdyb3VwIH0pO1xyXG4gICAgICAgIGFjdGlvbnMuY2xvc2VNb2RhbCgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlUHVsbFJlZnJlc2goc2NoZWR1bGVTZXJ2aWNlOiBTY2hlZHVsZVNlcnZpY2UpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRvYXN0Py5zaG93KCfQn9GA0L7QstC10YDRj9GOINC+0LHQvdC+0LLQu9C10L3QuNGPLi4uJywgJ29rJyk7XHJcbiAgICBjb25zdCBjdXJyZW50VmVyc2lvbiA9IGFwcFN0b3JlLmdldCgnc2NoZWR1bGUnKS52YWx1ZT8udmVyc2lvbiB8fCAnJztcclxuICAgIGNvbnN0IHsgaGFzVXBkYXRlIH0gPSBhd2FpdCBzY2hlZHVsZVNlcnZpY2UuY2hlY2tVcGRhdGVzKGN1cnJlbnRWZXJzaW9uKTtcclxuXHJcbiAgICBpZiAoaGFzVXBkYXRlKSB7XHJcbiAgICAgIGNvbnN0IHNjaGVkdWxlID0gYXdhaXQgc2NoZWR1bGVTZXJ2aWNlLmxvYWQoKTtcclxuICAgICAgYWN0aW9ucy5zZXRTY2hlZHVsZShzY2hlZHVsZSk7XHJcbiAgICAgIHRvYXN0Py5zaG93KCfQoNCw0YHQv9C40YHQsNC90LjQtSDQvtCx0L3QvtCy0LvQtdC90L4nLCAnb2snKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRvYXN0Py5zaG93KCfQntCx0L3QvtCy0LvQtdC90LjQuSDQvdC10YInLCAnb2snKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHN0YXJ0VXBkYXRlQ2hlY2tlcihzY2hlZHVsZVNlcnZpY2U6IFNjaGVkdWxlU2VydmljZSk6IHZvaWQge1xyXG4gICAgLy8gQ2hlY2sgb24gdmlzaWJpbGl0eSBjaGFuZ2VcclxuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmIChkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJykge1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnRWZXJzaW9uID0gYXBwU3RvcmUuZ2V0KCdzY2hlZHVsZScpLnZhbHVlPy52ZXJzaW9uIHx8ICcnO1xyXG4gICAgICAgIGNvbnN0IHsgaGFzVXBkYXRlLCB2ZXJzaW9uLCB1cGRhdGVkQXQgfSA9XHJcbiAgICAgICAgICBhd2FpdCBzY2hlZHVsZVNlcnZpY2UuY2hlY2tVcGRhdGVzKGN1cnJlbnRWZXJzaW9uKTtcclxuICAgICAgICBpZiAoaGFzVXBkYXRlKSB7XHJcbiAgICAgICAgICBhY3Rpb25zLnNldFVwZGF0ZUF2YWlsYWJsZSh7IHZlcnNpb24sIHVwZGF0ZWRBdCB9KTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFBlcmlvZGljIGNoZWNrIGV2ZXJ5IDUgbWludXRlc1xyXG4gICAgc2V0SW50ZXJ2YWwoXHJcbiAgICAgIGFzeW5jICgpID0+IHtcclxuICAgICAgICBjb25zdCBjdXJyZW50VmVyc2lvbiA9IGFwcFN0b3JlLmdldCgnc2NoZWR1bGUnKS52YWx1ZT8udmVyc2lvbiB8fCAnJztcclxuICAgICAgICBjb25zdCB7IGhhc1VwZGF0ZSwgdmVyc2lvbiwgdXBkYXRlZEF0IH0gPVxyXG4gICAgICAgICAgYXdhaXQgc2NoZWR1bGVTZXJ2aWNlLmNoZWNrVXBkYXRlcyhjdXJyZW50VmVyc2lvbik7XHJcbiAgICAgICAgaWYgKGhhc1VwZGF0ZSkge1xyXG4gICAgICAgICAgYWN0aW9ucy5zZXRVcGRhdGVBdmFpbGFibGUoeyB2ZXJzaW9uLCB1cGRhdGVkQXQgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICA1ICogNjAgKiAxMDAwXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gU3RhcnQgdGhlIGFwcFxyXG4gIGJvb3RzdHJhcCgpLmNhdGNoKChlcnIpID0+IHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tBcHBdIEZhdGFsIGVycm9yOicsIGVycik7XHJcbiAgICBkb2N1bWVudC5ib2R5LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoycmVtO3RleHQtYWxpZ246Y2VudGVyXCI+0J7RiNC40LHQutCwINC40L3QuNGG0LjQsNC70LjQt9Cw0YbQuNC4INC/0YDQuNC70L7QttC10L3QuNGPPC9kaXY+JztcclxuICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVyIFNlcnZpY2UgV29ya2VyIGZvciBQV0EgZnVuY3Rpb25hbGl0eS5cclxuICogUmVxdWlyZWQgZm9yIGJlZm9yZWluc3RhbGxwcm9tcHQgdG8gZmlyZSBvbiBDaHJvbWUgQW5kcm9pZC5cclxuICovXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyU2VydmljZVdvcmtlcigpOiB2b2lkIHtcclxuICBpZiAoJ3NlcnZpY2VXb3JrZXInIGluIG5hdmlnYXRvcikge1xyXG4gICAgbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXJcclxuICAgICAgLnJlZ2lzdGVyKGAke2ltcG9ydC5tZXRhLmVudi5CQVNFX1VSTH1zdy5qc2AsIHtcclxuICAgICAgICBzY29wZTogaW1wb3J0Lm1ldGEuZW52LkJBU0VfVVJMLFxyXG4gICAgICB9KVxyXG4gICAgICAudGhlbigocmVnKSA9PiB7XHJcbiAgICAgICAgaWYgKGltcG9ydC5tZXRhLmVudi5ERVYpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKCdbU1ddIFJlZ2lzdGVyZWQ6JywgcmVnLnNjb3BlKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW1NXXSBSZWdpc3RyYXRpb24gZmFpbGVkOicsIGVycik7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBiZWZvcmVpbnN0YWxscHJvbXB0IGZvciBQV0EgaW5zdGFsbCBidXR0b24uXHJcbiAqIFNob3dzIHRoZSBpbnN0YWxsIGJ1dHRvbiB3aGVuIHRoZSBldmVudCBmaXJlcy5cclxuICovXHJcbmxldCBkZWZlcnJlZFByb21wdDogQmVmb3JlSW5zdGFsbFByb21wdEV2ZW50IHwgbnVsbCA9IG51bGw7XHJcblxyXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JlaW5zdGFsbHByb21wdCcsIChlOiBFdmVudCkgPT4ge1xyXG4gIGNvbnN0IHByb21wdEV2ZW50ID0gZSBhcyBCZWZvcmVJbnN0YWxsUHJvbXB0RXZlbnQ7XHJcbiAgcHJvbXB0RXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICBkZWZlcnJlZFByb21wdCA9IHByb21wdEV2ZW50O1xyXG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbnN0YWxsQnRuJyk7XHJcbiAgaWYgKGJ0bikgYnRuLmNsYXNzTGlzdC5yZW1vdmUoJ2hpZGRlbicpO1xyXG59KTtcclxuXHJcbmNvbnN0IGluc3RhbGxCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaW5zdGFsbEJ0bicpO1xyXG5pZiAoaW5zdGFsbEJ0bikge1xyXG4gIGluc3RhbGxCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoIWRlZmVycmVkUHJvbXB0KSB7XHJcbiAgICAgIGFsZXJ0KCfQntGC0LrRgNC+0LnRgtC1INC80LXQvdGOINCx0YDQsNGD0LfQtdGA0LAg4oaSINCU0L7QsdCw0LLQuNGC0Ywg0L3QsCDQs9C70LDQstC90YvQuSDRjdC60YDQsNC9Jyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGRlZmVycmVkUHJvbXB0LnByb21wdCgpO1xyXG4gICAgY29uc3QgeyBvdXRjb21lIH0gPSBhd2FpdCBkZWZlcnJlZFByb21wdC51c2VyQ2hvaWNlO1xyXG4gICAgaWYgKG91dGNvbWUgPT09ICdhY2NlcHRlZCcpIHtcclxuICAgICAgaW5zdGFsbEJ0bi5jbGFzc0xpc3QuYWRkKCdoaWRkZW4nKTtcclxuICAgIH1cclxuICAgIGRlZmVycmVkUHJvbXB0ID0gbnVsbDtcclxuICB9KTtcclxufVxyXG5cclxuLy8gVHlwZSBmb3IgYmVmb3JlaW5zdGFsbHByb21wdCBldmVudFxyXG5pbnRlcmZhY2UgQmVmb3JlSW5zdGFsbFByb21wdEV2ZW50IGV4dGVuZHMgRXZlbnQge1xyXG4gIHByb21wdDogKCkgPT4gUHJvbWlzZTx2b2lkPjtcclxuICB1c2VyQ2hvaWNlOiBQcm9taXNlPHsgb3V0Y29tZTogJ2FjY2VwdGVkJyB8ICdkaXNtaXNzZWQnIH0+O1xyXG59XHJcbiJdfQ==