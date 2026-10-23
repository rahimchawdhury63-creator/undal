/**
 * @file apps/admin_web/src/main.tsx
 * @description Browser root mount for UNDAL Super Admin Web importing shared CSS tokens.
 */

import '@undal/shared-ts/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
