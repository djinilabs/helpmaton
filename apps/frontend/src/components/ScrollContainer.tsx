import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { Ref } from "react";

interface ScrollContainerProps {
  className?: string;
  children?: React.ReactNode;
  /** Use a smaller max height (e.g. inside modals). Default is 100vh. */
  maxHeight?: string | number;
  /** Show right-edge scroll hint when horizontally scrollable. Default true. */
  showScrollHint?: boolean;
  /** Optional. When set, the scroll area gets role="region", this aria-label, and tabIndex=0 for keyboard scroll. Omit to avoid an extra tab stop and wrong label when content is not a table. */
  ariaLabel?: string;
}

/**
 * Scrollable container with max height of one screen (or custom).
 * Forwards a ref so parents can use it as the scroll element for useVirtualizer.
 * Adds touch-friendly horizontal scroll and a right-edge scroll hint when content overflows.
 */
export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
  function ScrollContainer(
    {
      className,
      children,
      maxHeight = "100vh",
      showScrollHint = true,
      ariaLabel,
    },
    ref: Ref<HTMLDivElement>
  ) {
    const innerRef = useRef<HTMLDivElement>(null);
    const [showRightHint, setShowRightHint] = useState(false);

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      },
      [ref]
    );

    const updateHint = useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const scrollable = el.scrollWidth > el.clientWidth;
      const notAtEnd = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setShowRightHint(scrollable && notAtEnd);
    }, []);

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      const rafId = requestAnimationFrame(() => updateHint());
      el.addEventListener("scroll", updateHint, { passive: true });
      const ro = new ResizeObserver(updateHint);
      ro.observe(el);
      return () => {
        cancelAnimationFrame(rafId);
        el.removeEventListener("scroll", updateHint);
        ro.disconnect();
      };
    }, [updateHint]);

    const style: React.CSSProperties = {
      minHeight: 200,
      maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
      overflow: "auto",
      WebkitOverflowScrolling: "touch",
    };

    return (
      <div className="relative">
        <div
          ref={setRefs}
          className={`${ariaLabel != null ? "outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2" : ""} ${className ?? ""}`}
          style={style}
          {...(ariaLabel != null
            ? { tabIndex: 0, role: "region" as const, "aria-label": ariaLabel }
            : {})}
        >
          {children}
        </div>
        {showScrollHint && showRightHint && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-neutral-200/90 to-transparent dark:from-neutral-700/90"
            aria-hidden
          />
        )}
      </div>
    );
  }
);
