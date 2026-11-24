/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The browser entry.
 *
 * A prerendered page is adopted with `hydrateRoot` so the markup a crawler indexed is the markup the
 * customer starts using; an empty container — which is what the dev server serves — is mounted
 * instead. Preferences are applied before the first paint so a dark-theme visitor never sees a flash
 * of white, and a failed chunk is reported rather than silently swallowed.
 */

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { routes } from "./routes.tsx";
import { usePrefs } from "./lib/prefs.ts";
import "./styles/global.css";

usePrefs.getState().apply();

const container = document.getElementById("root");
if (container === null) throw new Error("The storefront needs a #root element.");

const router = createBrowserRouter(routes);

const tree = (
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);

if (container.hasChildNodes()) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}

window.addEventListener("vite:preloadError", () => {
  // A stale chunk after a deploy: one reload picks up the new build rather than a blank page.
  window.location.reload();
});
