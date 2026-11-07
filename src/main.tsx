import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { boot, toast, setState } from './store';
import { registerSW } from 'virtual:pwa-register';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    // Never reload automatically: an import review or board edit could be in progress.
    onNeedRefresh() { setState({ updateReady: () => updateSW(true) }); },
    onOfflineReady() { toast('Vault Atlas is ready to work offline'); },
    onRegisterError() { /* e.g. inside a sandboxed preview frame — app still works online */ },
  });
}
