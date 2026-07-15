import { Outlet } from "react-router-dom";
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
