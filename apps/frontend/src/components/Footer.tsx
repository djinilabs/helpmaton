import type { FC } from "react";
import { Link } from "react-router-dom";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-neutral-200 bg-white mt-auto dark:border-neutral-700 dark:bg-neutral-900">
      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="relative overflow-hidden">
              <img
                src="/images/helpmaton_logo.svg"
                alt="Helmaton Logo"
                className="w-8 h-8 opacity-60 relative z-10"
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
            </div>
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              Helpmaton
            </span>
          </div>
          <div className="text-xs text-neutral-500 text-right dark:text-neutral-300">
            <div className="mb-1">RAW AI. NO BULLSHIT.</div>
            <div className="text-[10px]">
              © {currentYear} DjiniLabs & Gordon & Teixeira Lda.
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Link
                to="/docs/api"
                className="text-neutral-600 hover:text-neutral-900 font-semibold border-b-2 border-neutral-900 transition-colors dark:text-neutral-300 dark:hover:text-neutral-50 dark:border-neutral-50"
              >
                API Docs
              </Link>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <a
                href="/privacy"
                className="text-neutral-600 hover:text-neutral-900 font-semibold border-b-2 border-neutral-900 transition-colors dark:text-neutral-300 dark:hover:text-neutral-50 dark:border-neutral-50"
              >
                Privacy Statement
              </a>
              <span className="text-neutral-400 dark:text-neutral-600">|</span>
              <a
                href="/terms-of-service"
                className="text-neutral-600 hover:text-neutral-900 font-semibold border-b-2 border-neutral-900 transition-colors dark:text-neutral-300 dark:hover:text-neutral-50 dark:border-neutral-50"
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
