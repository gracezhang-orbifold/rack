import { NavLink } from "react-router-dom";
import type { Me } from "../lib/types";
import { useLogout } from "../hooks/queries";

// Menus copied from the approved reference (Figma "Asset Sphere"): the
// employee group for everyone, plus an Admin group for admins. Desktop-only
// (md+); phones use the bottom TabBar instead.
const EMPLOYEE_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/my-items", label: "My Assets", end: false },
  { to: "/requests/new", label: "Raise New Request", end: false },
  { to: "/requests/service", label: "Raise Service Request", end: false },
  { to: "/requests", label: "View Request Status", end: true },
];
const ADMIN_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/assets", label: "Total Assets", end: false },
  { to: "/admin/assigned", label: "Assigned Assets", end: false },
  { to: "/admin/requests", label: "View Request", end: false },
  { to: "/admin/add", label: "Add Asset", end: false },
  { to: "/admin/service", label: "Under Service", end: false },
  { to: "/admin/people", label: "People", end: false },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-xl px-3 py-2.5 text-sm transition-colors ${
    isActive ? "bg-primary font-medium text-on-primary" : "text-muted hover:bg-surface-2 hover:text-text"
  }`;

export function Sidebar({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto p-4 md:flex print:hidden">
      <span className="mb-5 px-3 font-display text-xl font-bold tracking-wide" style={{ fontStretch: "112%" }}>Rack</span>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {EMPLOYEE_ITEMS.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={itemClass}>{i.label}</NavLink>
        ))}
      </nav>
      {me.role === "admin" && (
        <>
          <p className="mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-muted/70">Admin</p>
          <nav aria-label="Admin" className="flex flex-col gap-1">
            {ADMIN_ITEMS.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={itemClass}>{i.label}</NavLink>
            ))}
          </nav>
        </>
      )}
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <button
          className="rounded-xl bg-warning/15 px-3 py-2.5 text-left text-sm font-medium text-warning transition-colors active:bg-warning/25"
          onClick={() => logout.mutate()}>
          Log Out
        </button>
        <NavLink to="/profile" aria-label="My account"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-xl px-3 py-1 pb-1 transition-colors ${isActive ? "bg-surface-2" : "active:bg-surface-2"}`}>
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary-soft">
            {(me.full_name ?? me.email).slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm">{me.full_name ?? me.email}</span>
            <span className="block text-xs capitalize text-muted">{me.role}</span>
          </span>
        </NavLink>
      </div>
    </aside>
  );
}
