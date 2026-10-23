/**
 * @file apps/customer_web/src/main.tsx
 * @description Browser root mount for UNDAL Customer Web importing shared CSS tokens.
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
