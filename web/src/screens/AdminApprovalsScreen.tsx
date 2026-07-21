import { useAdminApprovals, useDecideApproval, useSetApprovalMode } from "../hooks/queries";
import { Badge, Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// Checkout approvals: the pending queue (only fills up in manual mode), a log
// of recent decisions, and the auto/manual switch.
export function AdminApprovalsScreen() {
  const approvals = useAdminApprovals();
  const decide = useDecideApproval();
  const setMode = useSetApprovalMode();
  const toast = useToast();

  if (approvals.isLoading) return <Spinner />;
  if (approvals.isError) return <p className="p-4 text-sm text-muted">Couldn't load approvals.</p>;
  const { mode, pending, recent } = approvals.data!;

  const onDecide = (id: string, decision: "approve" | "deny") =>
    decide.mutate({ id, decision }, {
      onSuccess: () => toast(decision === "approve" ? "Approved — the requester has been notified." : "Denied — the requester has been notified."),
      onError: (e) => toast(errorMessage(e), "error"),
    });

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">Checkout approvals</h2>

      <div className="mb-4 flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
        <div>
          <p className="text-sm font-medium">Auto-approve checkouts</p>
          <p className="text-xs text-muted">
            {mode === "auto"
              ? "On — every checkout is approved instantly and logged below."
              : "Off — checkouts wait here for an admin decision."}
          </p>
        </div>
        <Button variant="secondary" disabled={setMode.isPending}
          onClick={() => setMode.mutate(mode === "auto" ? "manual" : "auto", {
            onSuccess: (r) => toast(r.mode === "auto" ? "Auto-approve on." : "Manual approval on."),
            onError: (e) => toast(errorMessage(e), "error"),
          })}>
          {mode === "auto" ? "Require approval" : "Turn auto-approve on"}
        </Button>
      </div>

      <h3 className="mb-2 text-sm font-semibold">Pending ({pending.length})</h3>
      {pending.length === 0 && (
        <p className="mb-4 text-sm text-muted">
          Nothing waiting{mode === "auto" ? " — auto-approve is on." : "."}
        </p>
      )}
      <ul className="mb-6 grid grid-cols-1 gap-2 md:grid-cols-2">
        {pending.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <div>
              <p className="font-medium">{a.item_name}</p>
              <p className="text-xs text-muted">{a.full_name ?? a.email} · {a.email}</p>
              <p className="text-xs text-muted/70">Requested {fmt(a.requested_at)}</p>
            </div>
            <div className="flex gap-2">
              <Button disabled={decide.isPending} onClick={() => onDecide(a.id, "approve")}>Approve</Button>
              <Button variant="secondary" disabled={decide.isPending} onClick={() => onDecide(a.id, "deny")}>Deny</Button>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 text-sm font-semibold">Recent</h3>
      {recent.length === 0 && <p className="text-sm text-muted">No checkouts yet.</p>}
      <ul className="flex flex-col gap-2">
        {recent.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-xl bg-surface p-3 text-sm shadow-sm shadow-black/20">
            <div>
              <p>{a.item_name} — <span className="text-muted">{a.full_name ?? a.email}</span></p>
              <p className="text-xs text-muted/70">
                {fmt(a.decided_at ?? a.requested_at)}
                {a.decided_by_email ? ` · by ${a.decided_by_email}` : ""}
              </p>
            </div>
            {a.status === "denied"
              ? <Badge tone="red">Denied</Badge>
              : a.auto_approved
                ? <Badge tone="gray">Auto-approved</Badge>
                : <Badge tone="green">{a.status === "used" ? "Approved · used" : "Approved"}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
