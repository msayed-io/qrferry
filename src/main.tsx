import React from 'react';
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
import { SendClient } from '../app/send-client';
import { ScannerClient } from '../app/scan/scanner-client';
import { HistoryClient } from '../app/history/history-client';
import { OfflineClient } from '../app/offline/offline-client';
import { PrivacyClient } from '../app/privacy/privacy-client';
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
  return <LangProvider initialLang="ar"><PwaRegister /><AppShell><RouteContent /></AppShell></LangProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
