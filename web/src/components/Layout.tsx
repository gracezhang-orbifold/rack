import { Outlet } from "react-router-dom";
import type { Me } from "../lib/types";
import { TabBar } from "./TabBar";
import { useLogout } from "../hooks/queries";

export function Layout({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col pb-16 print:max-w-none print:pb-0">
      <header className="flex items-center justify-between px-4 py-3 print:hidden">
        <span className="text-lg font-bold">Rack</span>
        <button className="text-sm text-gray-500" onClick={() => logout.mutate()}>Sign out</button>
      </header>
      <main className="flex-1 px-4"><Outlet context={me} /></main>
      <div className="print:hidden"><TabBar role={me.role} /></div>
    </div>
  );
}
