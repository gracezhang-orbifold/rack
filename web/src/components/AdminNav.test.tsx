import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { it, expect } from "vitest";
import { AdminNav } from "./AdminNav";

it("links to every admin page, including People and Add Asset", () => {
  render(<MemoryRouter initialEntries={["/admin"]}><AdminNav /></MemoryRouter>);
  const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual([
    "/admin", "/admin/assets", "/admin/assigned", "/admin/requests",
    "/admin/add", "/admin/service", "/admin/people",
  ]);
  expect(screen.getByRole("link", { name: "People" })).toBeInTheDocument();
});
