"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name,
      email,
      password,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign up failed");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-md space-y-4 rounded border border-slate-200 bg-white p-6"
      >
        <div>
          <h1 className="text-xl font-semibold">Create account</h1>
          <p className="mt-1 text-sm text-slate-600">
            Local/dev signup. Email verification is disabled for development.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">Name</span>
          <input
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Email</span>
          <input
            type="email"
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
        >
          {pending ? "Creating…" : "Sign up"}
        </button>
        <p className="text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
