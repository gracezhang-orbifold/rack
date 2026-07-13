import { Outlet } from "react-router-dom";
import type { Me } from "../lib/types";
import { TabBar } from "./TabBar";
import { useLogout } from "../hooks/queries";

export function Layout({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col pb-16">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-lg font-bold">Rack</span>
        <button className="text-sm text-gray-500" onClick={() => logout.mutate()}>Sign out</button>
      </header>
      <main className="flex-1 px-4"><Outlet context={me} /></main>
      <TabBar role={me.role} />
    </div>
  );
}
