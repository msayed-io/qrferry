import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import 'glisse/styles.css';
import '../app/globals.css';
import '../app/workspace.css';
import '../app/support.css';
import '../app/bridge/bridge.css';
import '../app/liquid-controls.css';
import { AppShell } from '../app/app-shell';
import { LangProvider } from '../app/lang-provider';
import { PwaRegister } from '../app/pwa-register';
const SendClient = lazy(() => import('../app/send-client').then(({ SendClient }) => ({ default: SendClient })));
const ScannerClient = lazy(() => import('../app/scan/scanner-client').then(({ ScannerClient }) => ({ default: ScannerClient })));
const HistoryClient = lazy(() => import('../app/history/history-client').then(({ HistoryClient }) => ({ default: HistoryClient })));
const OfflineClient = lazy(() => import('../app/offline/offline-client').then(({ OfflineClient }) => ({ default: OfflineClient })));
const PrivacyClient = lazy(() => import('../app/privacy/privacy-client').then(({ PrivacyClient }) => ({ default: PrivacyClient })));
import { usePathname } from '../app/router';

function RouteContent() {
  const path = usePathname();
  if (path === '/scan') return <ScannerClient />;
  if (path === '/history') return <HistoryClient />;
  if (path === '/offline') return <OfflineClient />;
  if (path === '/privacy') return <PrivacyClient />;
  if (path === '/bridge' || path === '/pc' || path === '/tv') return null;
  return <SendClient />;
}

function App() {
  return <LangProvider initialLang="ar"><PwaRegister /><AppShell><Suspense fallback={<div className="route-loading" role="status" aria-live="polite">…</div>}><RouteContent /></Suspense></AppShell></LangProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
