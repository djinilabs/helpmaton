import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";

import { ThemeToggle } from "./ThemeToggle";

export const Header: FC = () => {
  const location = useLocation();

  return (
    <header className="border-b-2 border-neutral-300 bg-white/90 shadow-medium backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/90">
      <div className="mx-auto max-w-7xl p-6 lg:px-8">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="group flex items-center gap-3 transition-all duration-200 hover:opacity-80"
          >
            <div className="relative">
              <img
                src="/images/helpmaton_logo.svg"
                alt="Helmaton Logo"
                className="relative z-10 size-11 transition-transform duration-200 group-hover:scale-105"
              />
            </div>
            <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-primary-700 to-accent-700 bg-clip-text text-transparent">
              Helpmaton
            </span>
          </Link>

          <nav className="flex items-center gap-4">
            <Link
              to="/"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname === "/"
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-primary-600 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
              }`}
            >
              Home
            </Link>
            <Link
              to="/workspaces"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname.startsWith("/workspaces")
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-primary-600 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
              }`}
            >
              Workspaces
            </Link>
            <Link
              to="/settings"
              className={`transform rounded-xl px-6 py-3 text-base font-bold transition-all duration-200 hover:scale-[1.05] ${
                location.pathname === "/settings" ||
                location.pathname.startsWith("/settings/")
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-primary-600 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
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
