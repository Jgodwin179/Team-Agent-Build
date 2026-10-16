import Link from "next/link";
import { isAuthenticated } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  if (await isAuthenticated()) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Team Agent Platform
        </h1>
        <p className="mt-3 text-slate-600">
          Private multi-tenant agent workspace. Development defaults to a test
          organization with outbound dry-run. Missing credentials use clearly
          labeled mocks — never presented as live.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/sign-in"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
