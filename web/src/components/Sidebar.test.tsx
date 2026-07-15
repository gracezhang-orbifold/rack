import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { Sidebar } from "./Sidebar";
import type { Me } from "../lib/types";

const user: Me = { id: "u1", email: "user@rack.local", role: "user", full_name: "Rack User" };
const admin: Me = { id: "a1", email: "admin@rack.local", role: "admin", full_name: null };

const renderWith = (me: Me) => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Sidebar me={me} /></MemoryRouter></QueryClientProvider>,
  );
};

// Menu options are copied from the reference design and must stay verbatim.
describe("Sidebar", () => {
  it("shows the employee menu (and user chip) for a regular user", () => {
    renderWith(user);
    for (const label of ["Dashboard", "My Assets", "Raise New Request", "Raise Service Request", "View Request Status"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
    expect(screen.getByText("Rack User")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Total Assets" })).not.toBeInTheDocument();
  });

  it("adds the admin menu for an admin", () => {
    renderWith(admin);
    for (const label of ["Total Assets", "Assigned Assets", "View Request", "Add Asset", "Under Service"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Two Dashboards: employee (/) and admin (/admin)
    expect(screen.getAllByRole("link", { name: "Dashboard" })).toHaveLength(2);
  });
});
