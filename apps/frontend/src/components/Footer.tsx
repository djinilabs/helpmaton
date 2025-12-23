import type { FC } from "react";
import { Link } from "react-router-dom";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="/images/helpmaton_logo.svg"
                alt="Helmaton Logo"
                className="relative z-10 size-8 opacity-60"
              />
            </div>
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              Helpmaton
            </span>
          </div>
          <div className="text-right text-xs text-neutral-500 dark:text-neutral-300">
            <div className="mb-1">RAW AI. NO BULLSHIT.</div>
            <div className="text-[10px]">
              © {currentYear} DjiniLabs & Gordon & Teixeira Lda.
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Link
                to="/docs/api"
                className="border-b-2 border-neutral-900 font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-neutral-50 dark:text-neutral-300 dark:hover:text-neutral-50"
              >
                API Docs
              </Link>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <a
                href="/privacy"
                className="border-b-2 border-neutral-900 font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-neutral-50 dark:text-neutral-300 dark:hover:text-neutral-50"
              >
                Privacy Statement
              </a>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <a
                href="/terms-of-service"
                className="border-b-2 border-neutral-900 font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:border-neutral-50 dark:text-neutral-300 dark:hover:text-neutral-50"
              >
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
