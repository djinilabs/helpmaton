import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";

import { ThemeToggle } from "./ThemeToggle";

export const Header: FC = () => {
  const location = useLocation();

  return (
    <header className="border-b-2 border-neutral-300 bg-white/90 backdrop-blur-md shadow-medium dark:border-neutral-700 dark:bg-neutral-900/90">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-3 hover:opacity-80 transition-all duration-200 group"
          >
            <div className="relative overflow-hidden">
              <img
                src="/images/helpmaton_logo.svg"
                alt="Helmaton Logo"
                className="w-11 h-11 transition-transform duration-200 group-hover:scale-105 relative z-10"
              />
              <div
                className="manga-shine-overlay absolute inset-0 z-20 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.4) 15%, transparent 30%), linear-gradient(45deg, transparent 25%, rgba(255, 255, 255, 0.3) 45%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0.3) 55%, transparent 75%)",
                  width: "200%",
                  height: "200%",
                }}
              ></div>
              <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-10 rounded-full blur-xl transition-opacity duration-200"></div>
            </div>
            <span className="text-2xl font-black text-neutral-900 tracking-tight dark:text-neutral-50">
              Helpmaton
            </span>
          </Link>

          <nav className="flex items-center gap-4">
            <Link
              to="/"
              className={`px-6 py-3 text-base font-bold rounded-xl transition-all duration-200 transform hover:scale-[1.05] ${
                location.pathname === "/"
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "text-neutral-900 hover:bg-neutral-100 hover:text-primary-600 border-2 border-transparent hover:border-neutral-300 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:text-primary-400 dark:hover:border-neutral-600"
              }`}
            >
              Home
            </Link>
            <Link
              to="/workspaces"
              className={`px-6 py-3 text-base font-bold rounded-xl transition-all duration-200 transform hover:scale-[1.05] ${
                location.pathname.startsWith("/workspaces")
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "text-neutral-900 hover:bg-neutral-100 hover:text-primary-600 border-2 border-transparent hover:border-neutral-300 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:text-primary-400 dark:hover:border-neutral-600"
              }`}
            >
              Workspaces
            </Link>
            <Link
              to="/settings"
              className={`px-6 py-3 text-base font-bold rounded-xl transition-all duration-200 transform hover:scale-[1.05] ${
                location.pathname === "/settings" ||
                location.pathname.startsWith("/settings/")
                  ? "bg-gradient-primary text-white shadow-colored"
                  : "text-neutral-900 hover:bg-neutral-100 hover:text-primary-600 border-2 border-transparent hover:border-neutral-300 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:text-primary-400 dark:hover:border-neutral-600"
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
