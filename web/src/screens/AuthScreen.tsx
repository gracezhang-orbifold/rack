import { useState } from "react";
import { useLogin, useSignup } from "../hooks/queries";
import { Button, Input } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const login = useLogin();
  const signup = useSignup();
  const active = mode === "login" ? login : signup;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") login.mutate({ email, password });
    else signup.mutate({ email, password, full_name: name || undefined });
  };

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-bold">Rack</h1>
      <p className="mb-6 text-sm text-muted">
        {mode === "login" ? "Sign in to borrow equipment." : "Create your account."}
        {" "}Use your @orbifold.ai email.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <label className="text-sm">Name
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="text-sm">Email
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="text-sm">Password
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>
        <Button type="submit" disabled={active.isPending} className="mt-2">
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      {active.isError && <p className="mt-3 text-sm text-danger">{errorMessage(active.error)}</p>}
      <button className="mt-6 text-sm text-muted underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Create account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
