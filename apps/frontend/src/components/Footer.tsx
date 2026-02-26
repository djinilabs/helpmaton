import type { FC } from "react";
import { Link } from "react-router-dom";

import { BrandName } from "./BrandName";
import { Logo } from "./Logo";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();
  const version = import.meta.env.VITE_APP_VERSION || "0.0.0";

  return (
    <footer className="mt-auto border-t border-neutral-200 bg-white dark:border-t dark:border-neon-cyan/20 dark:bg-surface-50">
      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative size-8 shrink-0">
              <Logo className="relative z-10 size-full opacity-60" aria-label="Helpmaton Logo" />
            </div>
            <BrandName className="text-sm font-medium" />
          </div>
          <div className="text-right text-xs text-neutral-600 dark:text-neutral-200">
            <div className="mb-1">Straightforward AI. No fluff.</div>
            <div className="text-[10px]">
              © {currentYear} DjiniLabs & Gordon & Teixeira Lda.
            </div>
            <div className="mt-1 text-[10px]">Version {version}</div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
              <Link
                to="/docs/api"
                className="touch-target inline-flex items-center border-b-2 border-neutral-900 p-2 text-sm font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-blue-400/50 dark:text-neutral-300 dark:hover:text-blue-400 sm:text-base"
              >
                API Docs
              </Link>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <Link
                to="/privacy"
                className="touch-target inline-flex items-center border-b-2 border-neutral-900 p-2 text-sm font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-blue-400/50 dark:text-neutral-300 dark:hover:text-blue-400 sm:text-base"
              >
                Privacy Statement
              </Link>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <Link
                to="/terms-of-service"
                className="touch-target inline-flex items-center border-b-2 border-neutral-900 p-2 text-sm font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-blue-400/50 dark:text-neutral-300 dark:hover:text-blue-400 sm:text-base"
              >
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
