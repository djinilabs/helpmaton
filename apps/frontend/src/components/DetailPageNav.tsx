import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import type { FC, ReactNode } from "react";

export interface DetailPageNavItem {
  id: string;
  label: string;
}

export interface DetailPageNavGroup {
  title: string;
  icon: ReactNode;
  children: DetailPageNavItem[];
}

export interface DetailPageNavProps {
  groups: DetailPageNavGroup[];
  expandedSection: string | null;
  onToggleSection: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Default: "Page sections" */
  ariaLabel?: string;
  /** Default: "Sections" */
  headerTitle?: string;
}

const NAV_WIDTH_EXPANDED = "16rem";
const NAV_WIDTH_COLLAPSED = "4rem";
/** Fallback top (px) when the sticky breadcrumb nav isn't found (e.g. SSR). */
const FALLBACK_TOP_PX = 56;
/** Delay before scrolling so the accordion expand animation can start (AccordionSection uses 300ms transition). */
const SCROLL_AFTER_EXPAND_MS = 150;

function getTopBelowBreadcrumb(): number {
  if (typeof document === "undefined") return FALLBACK_TOP_PX;
  const breadcrumb = document.querySelector("nav.sticky") as HTMLElement | null;
  if (!breadcrumb) return FALLBACK_TOP_PX;
  return breadcrumb.getBoundingClientRect().bottom;
}

export const DetailPageNav: FC<DetailPageNavProps> = ({
  groups,
  expandedSection,
  onToggleSection,
  collapsed,
  onToggleCollapse,
  ariaLabel = "Page sections",
  headerTitle = "Sections",
}) => {
  const [topPx, setTopPx] = useState(FALLBACK_TOP_PX);

  useEffect(() => {
    const updateTop = () => setTopPx(getTopBelowBreadcrumb());
    updateTop();
    window.addEventListener("scroll", updateTop, { passive: true });
    window.addEventListener("resize", updateTop);
    const observer = new ResizeObserver(updateTop);
    const breadcrumb = document.querySelector("nav.sticky");
    if (breadcrumb) observer.observe(breadcrumb);
    return () => {
      window.removeEventListener("scroll", updateTop);
      window.removeEventListener("resize", updateTop);
      observer.disconnect();
    };
  }, []);

  const scrollToSection = (sectionId: string) => {
    if (expandedSection !== sectionId) {
      onToggleSection(sectionId);
    }
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = prefersReducedMotion ? "auto" : "smooth";
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        el?.scrollIntoView({ behavior });
        // Move focus to the section's accordion header for keyboard/screen reader users
        const header = el?.querySelector<HTMLButtonElement>(
          'button[aria-expanded][aria-controls]'
        );
        header?.focus({ preventScroll: true });
      }, SCROLL_AFTER_EXPAND_MS);
    });
  };

  return (
    <nav
      aria-label={ariaLabel}
      className="fixed left-0 z-30 hidden flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 dark:border-neutral-700 dark:bg-neutral-900 lg:flex"
      style={{
        top: `${topPx}px`,
        bottom: 0,
        width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH_EXPANDED,
      }}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-neutral-200 px-2 dark:border-neutral-700">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex size-9 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-5" />
          ) : (
            <ChevronLeftIcon className="size-5" />
          )}
        </button>
        {!collapsed && (
          <span className="ml-1 truncate text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {headerTitle}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 px-1">
            {groups.map((group) => {
              const firstId = group.children[0]?.id;
              if (!firstId) return null;
              return (
                <button
                  key={group.title}
                  type="button"
                  onClick={() => scrollToSection(firstId)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  title={group.title}
                >
                  {group.icon}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1 px-2">
            {groups.map((group) => (
              <div key={group.title} className="space-y-0.5">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex size-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400 [&>svg]:size-5">
                    {group.icon}
                  </span>
                  <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {group.title}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.children.map((item) => {
                    const isActive = expandedSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => scrollToSection(item.id)}
                        className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? "bg-primary-100 font-semibold text-primary-800 dark:bg-primary-900/50 dark:text-primary-200"
                            : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
};
