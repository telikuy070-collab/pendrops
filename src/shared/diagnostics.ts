/**
 * Runtime diagnostics: which build is running.
 *
 * The values come from `package.json` through the Vite `define`, so the version
 * reported in diagnostics is always the version that was built — there is no
 * second, hand-maintained version constant.
 */
import { APP_VERSION, BUILD_DATE, BUILD_TIMESTAMP } from '../constants.js';

export interface BuildDiagnostics {
  appVersion: string;
  buildTimestamp: number;
  buildDate: string;
  /** ISO day the bundle was built, or an empty string outside a real build. */
  builtOn: string;
}

export function getBuildDiagnostics(): BuildDiagnostics {
  return {
    appVersion: APP_VERSION,
    buildTimestamp: BUILD_TIMESTAMP,
    buildDate: BUILD_DATE,
    builtOn: BUILD_DATE ? BUILD_DATE.slice(0, 10) : '',
  };
}

/** One-line, credential-free build identification for user-facing surfaces. */
export function formatBuildDiagnostics(
  diagnostics: BuildDiagnostics = getBuildDiagnostics()
): string {
  return diagnostics.builtOn
    ? `Версия ${diagnostics.appVersion} (сборка ${diagnostics.builtOn})`
    : `Версия ${diagnostics.appVersion}`;
}
