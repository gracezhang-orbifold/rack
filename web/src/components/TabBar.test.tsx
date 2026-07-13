import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { TabBar } from "./TabBar";

const renderAt = (role: "user" | "admin") =>
  render(<MemoryRouter><TabBar role={role} /></MemoryRouter>);

describe("TabBar", () => {
  it("shows Browse and My Items for a regular user, hides Admin", () => {
    renderAt("user");
    expect(screen.getByRole("link", { name: /browse/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /my items/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });
  it("shows Admin for an admin", () => {
    renderAt("admin");
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });
});
