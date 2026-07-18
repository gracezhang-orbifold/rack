import { useState } from "react";
import {
  useAddAllowlist, useAdminAllowlist, useAdminUsers, useMe, useRemoveAllowlist,
  useSetUserPassword, useSetUserRole,
} from "../hooks/queries";
import { Badge, Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { AdminUser } from "../lib/types";

// Admin sets a user's password (e.g. "I forgot mine"); the user is signed
// out everywhere and logs back in with it.
function SetPasswordSheet({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const setPassword = useSetUserPassword();
  const toast = useToast();
  const [password, setPassword_] = useState("");

  const submit = () =>
    setPassword.mutate({ id: user.id, password }, {
      onSuccess: () => { toast(`Password set for ${user.full_name ?? user.email}.`); onClose(); },
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div>
        <h3 className="text-lg font-semibold">Set password</h3>
        <p className="text-xs text-muted">
          {user.email} will be signed out everywhere and must log in with the new password.
        </p>
      </div>
      <Input type="password" autoComplete="new-password" placeholder="New password (8+ characters)"
        value={password} onChange={(e) => setPassword_(e.target.value)} />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" disabled={password.length < 8 || setPassword.isPending}>
          {setPassword.isPending ? "Setting…" : "Set password"}
        </Button>
      </div>
    </form>
  );
}

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// People: who can sign in, who is an admin, and which emails are
// pre-authorized to become admins the moment they sign up.
export function AdminPeopleScreen() {
  const me = useMe();
  const users = useAdminUsers();
  const allowlist = useAdminAllowlist();
  const setRole = useSetUserRole();
  const addInvite = useAddAllowlist();
  const removeInvite = useRemoveAllowlist();
  const toast = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [passwordFor, setPasswordFor] = useState<string | null>(null);

  if (users.isLoading || allowlist.isLoading) return <Spinner />;
  if (users.isError || allowlist.isError)
    return <p className="p-4 text-sm text-muted">Couldn't load people.</p>;

  const changeRole = (id: string, role: "admin" | "user") =>
    setRole.mutate({ id, role }, {
      onSuccess: (u) => toast(`${u.full_name ?? u.email} is now ${u.role === "admin" ? "an admin" : "a member"}.`),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  const invite = () => {
    addInvite.mutate(inviteEmail.trim(), {
      onSuccess: (e) => { setInviteEmail(""); toast(`${e.email} will be an admin when they sign up.`); },
      onError: (err) => toast(errorMessage(err), "error"),
    });
  };

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">People</h2>

      <div className="overflow-x-auto rounded-xl bg-surface shadow-sm shadow-black/20">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted/70">
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Joined</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.data!.map((u) => (
              <tr key={u.id} className="border-t border-edge/40">
                <td className="px-3 py-2 font-medium">{u.full_name ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{u.email}</td>
                <td className="px-3 py-2">
                  <Badge tone={u.role === "admin" ? "green" : "gray"}>{u.role}</Badge>
                </td>
                <td className="px-3 py-2 text-muted">{fmt(u.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  {u.id !== me.data?.id && (
                    <span className="flex justify-end gap-3 whitespace-nowrap">
                      <button className="text-xs text-muted underline"
                        onClick={() => setPasswordFor(u.id)}>
                        Set password
                      </button>
                      <button className="text-xs text-primary-soft underline" disabled={setRole.isPending}
                        onClick={() => changeRole(u.id, u.role === "admin" ? "user" : "admin")}>
                        {u.role === "admin" ? "Demote" : "Make admin"}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-5">
        <h3 className="mb-1 text-sm font-semibold text-muted">Pending admin invites</h3>
        <p className="mb-2 text-xs text-muted/70">
          These emails become admins the moment they sign up.
        </p>
        <div className="mb-2 flex gap-2">
          <Input placeholder="teammate@orbifold.ai" type="email" value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && inviteEmail.trim()) invite(); }} />
          <Button className="shrink-0 whitespace-nowrap" disabled={!inviteEmail.trim() || addInvite.isPending}
            onClick={invite}>
            Add invite
          </Button>
        </div>
        {allowlist.data!.length === 0
          ? <p className="text-xs text-muted/70">No pending invites.</p>
          : (
            <ul className="flex flex-col gap-1">
              {allowlist.data!.map((e) => (
                <li key={e.email} className="flex items-center justify-between rounded-xl bg-surface p-3 text-sm shadow-sm shadow-black/20">
                  <span>{e.email}<span className="ml-2 text-xs text-muted/70">added {fmt(e.created_at)}</span></span>
                  <button className="text-xs text-muted underline" disabled={removeInvite.isPending}
                    onClick={() => removeInvite.mutate(e.email, {
                      onError: (err) => toast(errorMessage(err), "error"),
                    })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <Sheet open={passwordFor !== null} onClose={() => setPasswordFor(null)}>
        {passwordFor && (() => {
          const u = users.data!.find((x) => x.id === passwordFor);
          return u ? <SetPasswordSheet key={u.id} user={u} onClose={() => setPasswordFor(null)} /> : null;
        })()}
      </Sheet>
    </div>
  );
}
