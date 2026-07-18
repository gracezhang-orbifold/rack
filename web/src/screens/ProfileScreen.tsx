import { useState } from "react";
import { useChangePassword, useMe } from "../hooks/queries";
import { Button, Card, Input, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

// Account page: who you're signed in as, and password self-service.
export function ProfileScreen() {
  const me = useMe();
  const changePassword = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  if (me.isLoading) return <Spinner />;
  if (me.isError || !me.data) return <p className="p-4 text-sm text-muted">Couldn't load your account.</p>;

  const mismatch = again.length > 0 && next !== again;
  const canSubmit = current && next.length >= 8 && next === again && !changePassword.isPending;

  const submit = () =>
    changePassword.mutate({ current, next }, {
      onSuccess: () => {
        setCurrent(""); setNext(""); setAgain("");
        toast("Password changed. Other devices were signed out.");
      },
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <div className="animate-fade-up flex flex-col gap-4 py-3">
      <h2 className="text-lg font-semibold">My account</h2>

      <Card className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/20 text-lg font-semibold text-primary-soft">
          {(me.data.full_name ?? me.data.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{me.data.full_name ?? "—"}</p>
          <p className="truncate text-sm text-muted">{me.data.email}</p>
          <p className="text-xs capitalize text-muted/70">{me.data.role}</p>
        </div>
      </Card>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted">Change password</h3>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(); }}>
          <Input type="password" autoComplete="current-password" placeholder="Current password"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder="New password (8+ characters)"
            value={next} onChange={(e) => setNext(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder="Repeat new password"
            value={again} onChange={(e) => setAgain(e.target.value)} />
          {mismatch && <p className="text-xs text-danger">Passwords don't match.</p>}
          <Button type="submit" disabled={!canSubmit}>
            {changePassword.isPending ? "Changing…" : "Change password"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted/70">
          Changing your password signs you out everywhere else.
        </p>
      </section>
    </div>
  );
}
