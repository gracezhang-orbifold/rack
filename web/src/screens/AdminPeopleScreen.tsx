import { useState } from "react";
import {
  useAddAllowlist, useAdminAllowlist, useAdminUsers, useMe, useRemoveAllowlist, useSetUserRole,
} from "../hooks/queries";
import { Badge, Button, Input, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

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
                    <button className="text-xs text-primary-soft underline" disabled={setRole.isPending}
                      onClick={() => changeRole(u.id, u.role === "admin" ? "user" : "admin")}>
                      {u.role === "admin" ? "Demote" : "Make admin"}
                    </button>
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
    </div>
  );
}
