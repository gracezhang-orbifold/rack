import type { LastReturn } from "../lib/types";

// Shown right after checkout when the previous borrower's return report
// matters to the next user — flagged contents ("don't wipe"), damage, or notes.
export function LastReturnNotice({ lastReturn }: { lastReturn: LastReturn | null | undefined }) {
  if (!lastReturn) return null;
  const { flagged, damaged, note, answers } = lastReturn;
  if (!flagged && !damaged && !note && answers.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl bg-warning/10 p-3 text-left">
      <p className="mb-1 text-sm font-medium text-warning">
        {flagged ? "Heads up — the previous borrower flagged this item" : "Previous borrower reported"}
      </p>
      {answers.map((p, i) => (
        <p key={i} className="text-sm text-warning">
          {p.label} <strong>{p.value === true ? "yes" : p.value === false ? "no" : p.value}</strong>
        </p>
      ))}
      {(damaged || note) && (
        <p className="text-sm text-warning">
          {damaged ? "Reported damaged" : "Note"}
          {note ? `: ${note}` : ""}
        </p>
      )}
    </div>
  );
}
