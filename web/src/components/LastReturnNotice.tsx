import type { LastReturn } from "../lib/types";

// Shown right after checkout when the previous borrower's return report
// matters to the next user — flagged contents ("don't wipe") or notes.
export function LastReturnNotice({ lastReturn }: { lastReturn: LastReturn | null | undefined }) {
  if (!lastReturn || (!lastReturn.flagged && lastReturn.answers.length === 0)) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left">
      <p className="mb-1 text-sm font-medium text-amber-800">
        {lastReturn.flagged ? "Heads up — the previous borrower flagged this item" : "Previous borrower reported"}
      </p>
      {lastReturn.answers.map((p, i) => (
        <p key={i} className="text-sm text-amber-800">
          {p.label} <strong>{p.value === true ? "yes" : p.value === false ? "no" : p.value}</strong>
        </p>
      ))}
    </div>
  );
}
