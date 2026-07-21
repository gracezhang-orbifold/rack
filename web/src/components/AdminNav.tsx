import { NavLink } from "react-router-dom";

// Mobile-only nav between admin pages. The desktop sidebar lists these in its
// Admin group, but phones only get the bottom-bar "Admin" tab (the dashboard)
// — without this strip, pages the dashboard tiles don't link to (People,
// Add Asset) are unreachable on mobile.
const chip = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
    isActive ? "border-primary bg-primary font-semibold text-on-primary" : "border-edge text-muted"
  }`;

export function AdminNav() {
  return (
    <nav aria-label="Admin sections"
      className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden print:hidden">
      <NavLink to="/admin" end className={chip}>Dashboard</NavLink>
      <NavLink to="/admin/assets" className={chip}>Assets</NavLink>
      <NavLink to="/admin/assigned" className={chip}>Assigned</NavLink>
      <NavLink to="/admin/requests" className={chip}>Requests</NavLink>
      <NavLink to="/admin/add" className={chip}>Add Asset</NavLink>
      <NavLink to="/admin/service" className={chip}>Service</NavLink>
      <NavLink to="/admin/approvals" className={chip}>Approvals</NavLink>
      <NavLink to="/admin/people" className={chip}>People</NavLink>
    </nav>
  );
}
