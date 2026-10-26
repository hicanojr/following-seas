"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/brief", label: "Brief", icon: CompassIcon },
  { href: "/jobs", label: "Jobs", icon: ListIcon },
  { href: "/profiles", label: "Profiles", icon: ChartIcon },
  { href: "/tracker", label: "Tracker", icon: LogIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                <Icon active={active} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type IconProps = { active: boolean };
const stroke = (active: boolean) => ({
  fill: "none",
  stroke: "currentColor",
  strokeWidth: active ? 2 : 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

function CompassIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...stroke(active)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5Z" />
    </svg>
  );
}
function ListIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...stroke(active)}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}
function ChartIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...stroke(active)}>
      <path d="M4 5h16v14H4z" />
      <path d="M4 12c4-3 8 3 16 0" />
    </svg>
  );
}
function LogIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...stroke(active)}>
      <path d="M6 3h10l3 3v15H6z" />
      <path d="M9 10h7M9 14h7M9 18h4" />
    </svg>
  );
}
