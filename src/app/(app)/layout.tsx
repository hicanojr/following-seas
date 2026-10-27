import type { ReactNode } from "react";
import { TabBar } from "@/components/TabBar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-line bg-background/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-xl items-center justify-between px-5 py-3">
          <span className="font-serif text-lg tracking-wide">Fair Winds</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 pt-6 pb-28">{children}</main>
      <TabBar />
    </>
  );
}
