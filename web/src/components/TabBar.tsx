import { NavLink } from "react-router-dom";
import type { Role } from "../lib/types";

// Active tab: primary text plus a small indicator bar along the top edge.
const tabClass = ({ isActive }: { isActive: boolean }) =>
  `relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors ${
    isActive
      ? "font-semibold text-primary-soft after:absolute after:inset-x-6 after:top-0 after:h-0.5 after:rounded-full after:bg-primary"
      : "text-muted"
  }`;

export function TabBar({ role }: { role: Role }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <NavLink to="/" end className={tabClass}>Dashboard</NavLink>
      <NavLink to="/my-items" className={tabClass}>My Assets</NavLink>
      <NavLink to="/requests" className={tabClass}>Requests</NavLink>
      {role === "admin" && <NavLink to="/admin" className={tabClass}>Admin</NavLink>}
    </nav>
  );
}
