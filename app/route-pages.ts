import { createElement, type ComponentType } from 'react';

/** The component and navigation share ONE module readiness state. React.lazy's
 * private cache cannot be primed just by awaiting import(): it can still suspend
 * on first render and show the fallback. This keeps Suspense for direct entry,
 * but a preloaded route renders synchronously without replacing the old page
 * with a loading frame. Component identity and mounted state remain stable. */
function page(importer: () => Promise<{ default: ComponentType }>) {
  let component: ComponentType | undefined;
  let pending: Promise<void> | undefined;
  let failed = false;
  let failure: unknown;
  const load = () => pending ??= importer().then(module => {
    component = module.default;
  }, error => { failed = true; failure = error; throw error; });
  function View() {
    if (failed) throw failure;
    if (!component) throw load();
    return createElement(component);
  }
  return { View, load, get ready() { return !!component; } };
}
export const SendPage = page(() => import('./send-client').then(m => ({ default: m.SendClient })));
export const ScanPage = page(() => import('./scan/scanner-client').then(m => ({ default: m.ScannerClient })));
export const BridgePage = page(() => import('./bridge/bridge-client').then(m => ({ default: m.BridgeClient })));
export const HistoryPage = page(() => import('./history/history-client').then(m => ({ default: m.HistoryClient })));
export const PrivacyPage = page(() => import('./privacy/privacy-client').then(m => ({ default: m.PrivacyClient })));
export const TvPage = page(() => import('./tv/tv-client').then(m => ({ default: m.TvClient })));
export const LocalPage = page(() => import('./local/local-client').then(m => ({ default: m.LocalClient })));
const pages: Record<string, ReturnType<typeof page>> = {
  '/local': LocalPage, '/local/send': LocalPage, '/local/receive': LocalPage, '/local/scan': LocalPage, '/local/setup': LocalPage, '/local/session': LocalPage,
  '/local/radar': LocalPage, '/local/profile': LocalPage,
  '/': SendPage, '/scan': ScanPage, '/bridge': BridgePage, '/pc': BridgePage,
  '/history': HistoryPage, '/privacy': PrivacyPage, '/tv': TvPage,
};
export function prepareRoute(path: string) {
  const next = pages[path] ?? (path.startsWith('/local/') ? LocalPage : undefined);
  return next && !next.ready ? next.load() : undefined;
}
