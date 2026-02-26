import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import type { FC } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";

import { useEscapeKey } from "../hooks/useEscapeKey";

import { BrandName } from "./BrandName";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const navLinkBase =
  "transform rounded-xl text-base font-bold transition-all duration-200 hover:scale-[1.05] min-h-[44px] min-w-[44px] inline-flex items-center justify-center";
const navLinkActive =
  "bg-gradient-primary text-white shadow-colored dark:!bg-gradient-neon-dark dark:!text-white dark:!shadow-neon-cyan-sm";
const navLinkInactive =
  "border-2 border-transparent text-neutral-900 hover:border-neutral-300 hover:bg-neutral-100 hover:text-blue-600 dark:text-neutral-200 dark:hover:border-neon-cyan/40 dark:hover:bg-neon-cyan/10 dark:hover:text-neon-cyan";

export const Header: FC = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEscapeKey(menuOpen, () => setMenuOpen(false));

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
            <BrandName className="font-display text-2xl font-black tracking-tight" />
          </Link>

          {/* Desktop nav: visible from md up */}
          <nav className="hidden items-center gap-4 md:flex" aria-label="Main">
            <Link
              to="/"
              className={`${navLinkBase} px-6 py-3 ${
                location.pathname === "/" ? navLinkActive : navLinkInactive
              }`}
            >
              Home
            </Link>
            <Link
              to="/workspaces"
              className={`${navLinkBase} px-6 py-3 ${
                location.pathname.startsWith("/workspaces")
                  ? navLinkActive
                  : navLinkInactive
              }`}
            >
              Workspaces
            </Link>
            <Link
              to="/settings"
              className={`${navLinkBase} px-6 py-3 ${
                location.pathname === "/settings" ||
                location.pathname.startsWith("/settings/")
                  ? navLinkActive
                  : navLinkInactive
              }`}
            >
              Settings
            </Link>
            <ThemeToggle />
          </nav>

          {/* Mobile: hamburger button */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border-2 border-transparent text-neutral-900 transition-all duration-200 hover:border-neutral-300 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:border-neon-cyan/40 dark:hover:bg-neon-cyan/10"
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Bars3Icon className="size-6" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer overlay: portaled to body so it paints above LocationBar and main */}
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] md:hidden"
            aria-hidden="true"
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 transition-opacity"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            />
            <div
              className="absolute right-0 top-0 flex size-full max-w-sm flex-col border-l-2 border-neutral-200 bg-white shadow-dramatic dark:border-neutral-700 dark:bg-surface-50"
              role="dialog"
              aria-label="Navigation menu"
            >
              <div className="flex min-h-[44px] items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
                <span className="font-display text-lg font-bold">Menu</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  aria-label="Close menu"
                >
                  <XMarkIcon className="size-6" />
                </button>
              </div>
              <nav className="flex flex-1 flex-col gap-1 p-4" aria-label="Main">
                <Link
                  to="/"
                  onClick={() => setMenuOpen(false)}
                  className={`${navLinkBase} px-4 py-3 ${
                    location.pathname === "/" ? navLinkActive : navLinkInactive
                  }`}
                >
                  Home
                </Link>
                <Link
                  to="/workspaces"
                  onClick={() => setMenuOpen(false)}
                  className={`${navLinkBase} px-4 py-3 ${
                    location.pathname.startsWith("/workspaces")
                      ? navLinkActive
                      : navLinkInactive
                  }`}
                >
                  Workspaces
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className={`${navLinkBase} px-4 py-3 ${
                    location.pathname === "/settings" ||
                    location.pathname.startsWith("/settings/")
                      ? navLinkActive
                      : navLinkInactive
                  }`}
                >
                  Settings
                </Link>
                <div className="mt-4 flex min-h-[44px] items-center">
                  <ThemeToggle />
                </div>
              </nav>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
};
