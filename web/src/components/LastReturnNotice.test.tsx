import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { LastReturnNotice } from "./LastReturnNotice";

const base = { flagged: false, damaged: false, note: null, returned_at: "2026-07-13T00:00:00Z", answers: [] };

it("renders nothing for null or a clean return", () => {
  const { container, rerender } = render(<LastReturnNotice lastReturn={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<LastReturnNotice lastReturn={base} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows a damage note with the neutral heading when not flagged", () => {
  render(<LastReturnNotice lastReturn={{ ...base, damaged: true, note: "lens cracked" }} />);
  expect(screen.getByText(/previous borrower reported/i)).toBeInTheDocument();
  expect(screen.getByText(/lens cracked/)).toBeInTheDocument();
  expect(screen.queryByText(/flagged this item/i)).not.toBeInTheDocument();
});

it("uses the flagged heading and renders yes/no answers", () => {
  render(<LastReturnNotice lastReturn={{ ...base, flagged: true, answers: [{ label: "Important — must not be wiped?", value: true }] }} />);
  expect(screen.getByText(/flagged this item/i)).toBeInTheDocument();
  expect(screen.getByText("yes")).toBeInTheDocument();
});
