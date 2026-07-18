import { Link, Outlet } from "react-router-dom";
import type { Me } from "../lib/types";
import { TabBar } from "./TabBar";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ui";
import { useLogout } from "../hooks/queries";

export function Layout({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col pb-16 md:max-w-6xl md:flex-row md:gap-6 md:px-4 md:pb-4 print:max-w-none print:pb-0">
      <Sidebar me={me} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-4 py-3 md:px-0 print:hidden">
          <span className="font-display text-lg font-bold tracking-wide md:hidden" style={{ fontStretch: "112%" }}>Rack</span>
          <span aria-hidden="true" className="hidden md:block" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {/* Desktop reaches the account page via the sidebar user chip */}
            <Link to="/profile" aria-label="My account"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2 md:hidden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
              </svg>
            </Link>
            {/* Desktop signs out from the sidebar's Log Out */}
            <button className="min-h-[44px] px-2 text-sm text-muted transition-colors md:hidden" onClick={() => logout.mutate()}>Sign out</button>
          </div>
        </header>
        <main className="flex-1 px-4 md:px-0"><Outlet context={me} /></main>
      </div>
      <div className="print:hidden"><TabBar role={me.role} /></div>
    </div>
  );
}
