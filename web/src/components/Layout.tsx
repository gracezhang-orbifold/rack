import { NavLink, Outlet } from "react-router-dom";
import type { Me } from "../lib/types";
import { TabBar } from "./TabBar";
import { ThemeToggle } from "./ui";
import { useLogout } from "../hooks/queries";

// Desktop nav mirrors the mobile TabBar targets; only one is visible at a time.
const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-primary/15 font-medium text-primary-soft" : "text-muted"}`;

export function Layout({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col pb-16 md:max-w-3xl md:pb-4 lg:max-w-5xl print:max-w-none print:pb-0">
      <header className="flex items-center justify-between px-4 py-3 print:hidden">
        <div className="flex items-center gap-6">
          <span className="font-display text-lg font-bold tracking-wide" style={{ fontStretch: "112%" }}>Rack</span>
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink to="/" end className={navClass}>Browse</NavLink>
            <NavLink to="/my-items" className={navClass}>My Items</NavLink>
            {me.role === "admin" && <NavLink to="/admin" className={navClass}>Admin</NavLink>}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button className="min-h-[44px] px-2 text-sm text-muted transition-colors" onClick={() => logout.mutate()}>Sign out</button>
        </div>
      </header>
      <main className="flex-1 px-4"><Outlet context={me} /></main>
      <div className="print:hidden"><TabBar role={me.role} /></div>
    </div>
  );
}
