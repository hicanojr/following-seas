import type { ReactNode } from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </header>
  );
}

export function EmptyState({
  heading,
  children,
  upcoming,
}: {
  heading: string;
  children: ReactNode;
  upcoming: string[];
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">
      <div className="mb-4 h-px w-12 bg-brass" aria-hidden />
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
      <ul className="mt-5 space-y-2 text-sm">
        {upcoming.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brass" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
