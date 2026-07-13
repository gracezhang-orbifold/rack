import { Navigate } from "react-router-dom";
import type { Me } from "../lib/types";

export function AdminOnly({ me, children }: { me: Me; children: React.ReactNode }) {
  if (me.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
