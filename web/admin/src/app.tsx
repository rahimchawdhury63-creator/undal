/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The console's routes and its gate.
 *
 * The gate is a UI convenience, not a security boundary: every route on the server re-checks the
 * permission, and this component only decides whether to draw a screen or a sign-in form. It
 * restores the session once on boot, which is what lets a refresh on `/admin/cash/settlements`
 * land back on the queue instead of the door.
 */

import { useEffect, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router";

import { Shell } from "./components/shell.tsx";
import { useSession } from "./lib/session.ts";
import { DashboardPage } from "./pages/dashboard.tsx";
import { DeclarationsPage } from "./pages/declarations.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { OrdersPage } from "./pages/orders.tsx";
import { SettlementsPage } from "./pages/settlements.tsx";
import { RidersPage } from "./pages/riders.tsx";
import { AuditPage } from "./pages/audit.tsx";
import { ZonesPage } from "./pages/zones.tsx";
import { GrowthPage } from "./pages/growth.tsx";
import { SignInPage } from "./pages/sign-in.tsx";
import { VendorsPage } from "./pages/vendors.tsx";

/** Draw the console for a signed-in reviewer, or the door for anybody else. */
function Gate(): ReactNode {
  const status = useSession((state) => state.status);
  const restore = useSession((state) => state.restore);
  const location = useLocation();

  useEffect(() => {
    if (status === "unknown") void restore();
  }, [status, restore]);

  if (status === "signed-in") return <Shell />;
  if (status === "unknown") {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }} role="status" aria-live="polite">
        <span style={{ color: "var(--color-text-secondary)" }}>…</span>
      </div>
    );
  }
  // The sign-in form keeps the requested path so the reviewer lands where they were going.
  return <SignInPage key={location.pathname} />;
}

/** The route table. Paths are relative to the `/admin` base the browser router is built with. */
const routes = [
  {
    path: "/",
    element: <Gate />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "cash/settlements", element: <SettlementsPage /> },
      { path: "cash/declarations", element: <DeclarationsPage /> },
      { path: "vendors", element: <VendorsPage /> },
      { path: "fleet", element: <RidersPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "zones", element: <ZonesPage /> },
      { path: "growth", element: <GrowthPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

/** The base path the console is served from, without a trailing slash. */
const BASE = (import.meta.env.BASE_URL ?? "/admin/").replace(/\/$/u, "");

/** The router instance. */
export const router = createBrowserRouter(routes, { basename: BASE });

/** The console. */
export function App(): ReactNode {
  return <RouterProvider router={router} />;
}
