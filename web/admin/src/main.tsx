/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The browser entry.
 *
 * There is no hydration here: the console is private, so it is rendered on the client and the
 * static host serves the same empty shell to everyone. That is also why the CSP can say
 * `script-src 'self'` with no inline allowance — the module graph is the only script on the page.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { AdminLocaleProvider } from "./lib/locale.tsx";
import "./styles/global.css";

const container = document.getElementById("root");
if (container === null) throw new Error("The console needs a #root element.");

createRoot(container).render(
  <StrictMode>
    <AdminLocaleProvider>
      <App />
    </AdminLocaleProvider>
  </StrictMode>,
);
