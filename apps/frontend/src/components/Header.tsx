import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";

import { BrandName } from "./BrandName";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export const Header: FC = () => {
  const location = useLocation();

  return (
    <header className="border-b-2 border-neutral-300 bg-white/90 shadow-medium backdrop-blur-md dark:border-b dark:border-neon-cyan/30 dark:bg-surface-50/90">
      <div className="mx-auto max-w-7xl p-6 lg:px-8">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="group flex items-center gap-3 transition-all duration-200 hover:opacity-80"
          >
            <div className="relative size-10 shrink-0">
              <Logo className="size-full" />
            </div>
            <BrandName className="text-2xl font-black tracking-tight" />
          </Link>

          <nav className="flex items-center gap-4">
            <Link
              to="/"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname === "/"
                  ? "bg-gradient-primary text-white shadow-colored dark:!bg-gradient-neon-dark dark:!text-white dark:!shadow-neon-cyan-sm"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-blue-600 dark:text-neutral-200 dark:hover:border-neon-cyan/40 dark:hover:bg-neon-cyan/10 dark:hover:text-neon-cyan"
              }`}
            >
              Home
            </Link>
            <Link
              to="/workspaces"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname.startsWith("/workspaces")
                  ? "bg-gradient-primary text-white shadow-colored dark:!bg-gradient-neon-dark dark:!text-white dark:!shadow-neon-cyan-sm"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-blue-600 dark:text-neutral-200 dark:hover:border-neon-cyan/40 dark:hover:bg-neon-cyan/10 dark:hover:text-neon-cyan"
              }`}
            >
              Workspaces
            </Link>
            <Link
              to="/settings"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname === "/settings" ||
                location.pathname.startsWith("/settings/")
                  ? "bg-gradient-primary text-white shadow-colored dark:!bg-gradient-neon-dark dark:!text-white dark:!shadow-neon-cyan-sm"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-blue-600 dark:text-neutral-200 dark:hover:border-neon-cyan/40 dark:hover:bg-neon-cyan/10 dark:hover:text-neon-cyan"
              }`}
            >
              Settings
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </div>
    </header>
  );
};
