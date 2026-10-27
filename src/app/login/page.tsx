import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <svg viewBox="0 0 64 64" width="56" height="56" className="mx-auto text-foreground" aria-hidden>
          <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M32 12v40M12 32h40" stroke="currentColor" strokeWidth="1" opacity=".4" />
          <path d="M40 24 35 35 24 40 29 29Z" fill="var(--brass)" />
        </svg>
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Fair Winds</h1>
        <p className="mt-1 text-sm text-muted">Your job search, kept steady and private.</p>
      </div>
      <Suspense fallback={<div className="h-40" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
