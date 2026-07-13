import { NavLink } from "react-router-dom";
import type { Role } from "../lib/types";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs ${isActive ? "text-gray-900 font-semibold" : "text-gray-500"}`;

export function TabBar({ role }: { role: Role }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/" end className={tabClass}>Browse</NavLink>
      <NavLink to="/my-items" className={tabClass}>My Items</NavLink>
      {role === "admin" && <NavLink to="/admin" className={tabClass}>Admin</NavLink>}
    </nav>
  );
}
