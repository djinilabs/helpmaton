import { useCallback, useEffect, useRef, useState } from "react";
import type { FC, ReactNode } from "react";

import { LazyAccordionContent } from "./LazyAccordionContent";

interface AccordionSectionProps {
  id: string;
  title: string | ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  contentClassName?: string;
}

export const AccordionSection: FC<AccordionSectionProps> = ({
  id,
  title,
  isExpanded,
  onToggle,
  children,
  contentClassName,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const innerContentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const hasMountedRef = useRef(false);
  const previousExpandedRef = useRef<boolean>(false);
  const referencePointRef = useRef<{
    scrollY: number;
    elementTop: number;
  } | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>(0);
  const getStickyNavOffset = useCallback(() => {
    const navElement = document.querySelector("nav.sticky") as HTMLElement | null;
    if (!navElement) {
      return 0;
    }

    const navHeight = navElement.getBoundingClientRect().height;
    const padding = 8;
    return navHeight + padding;
  }, []);
  const scrollHeaderIntoView = useCallback(
    (behavior: ScrollBehavior) => {
      if (!headerRef.current) {
        return;
      }

      const rect = headerRef.current.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const stickyOffset = getStickyNavOffset();
      const targetScroll = scrollTop + rect.top - stickyOffset;

      window.scrollTo({
        top: Math.max(0, targetScroll),
        behavior,
      });
    },
    [getStickyNavOffset]
  );

  // Measure content height when expanded or when content changes
  // Use ResizeObserver to handle dynamic content and ensure accurate measurements
  // Only measure when expanded since children are conditionally rendered
  useEffect(() => {
    if (!isExpanded || !innerContentRef.current) {
      return;
    }

    const measureHeight = () => {
      if (innerContentRef.current) {
        // Measure the inner content div which is only rendered when expanded
        const height = innerContentRef.current.offsetHeight;
        if (height > 0) {
          setMaxHeight(height);
        }
      }
    };

    // Initial measurement
    // Use requestAnimationFrame to ensure DOM is fully rendered after children mount
    const rafId = requestAnimationFrame(() => {
      measureHeight();
    });

    // Use ResizeObserver to watch for content size changes
    const resizeObserver = new ResizeObserver(() => {
      measureHeight();
    });

    resizeObserver.observe(innerContentRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [isExpanded, children]);

  // Maintain scroll position during transition, then scroll to header after animation
  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = isExpanded;

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (isExpanded) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollHeaderIntoView("smooth");
          });
        });
      }
      return;
    }

    // Only handle scroll position changes when state actually changes
    if (wasExpanded === isExpanded) {
      return;
    }

    // Only handle scroll behavior when expanding (not collapsing)
    if (!isExpanded) {
      return;
    }

    // Store reference point before any DOM changes
    // Use the header as a reference point to maintain relative position during transition
    if (headerRef.current) {
      const rect = headerRef.current.getBoundingClientRect();
      referencePointRef.current = {
        scrollY: window.scrollY,
        elementTop: rect.top + window.scrollY,
      };
    }

    // During the transition, maintain scroll position to prevent jumps
    // Use requestAnimationFrame to adjust scroll during the animation
    let animationFrameId: number | undefined;
    const startTime = Date.now();
    const transitionDuration = 300; // Match CSS transition duration

    const maintainScrollDuringTransition = () => {
      if (headerRef.current && referencePointRef.current) {
        const rect = headerRef.current.getBoundingClientRect();
        const newElementTop = rect.top + window.scrollY;
        const elementMovement =
          newElementTop - referencePointRef.current.elementTop;

        // Adjust scroll position to maintain the reference point's position relative to viewport
        // This prevents jumps during the transition
        if (elementMovement !== 0) {
          const newScrollY =
            referencePointRef.current.scrollY + elementMovement;
          window.scrollTo({
            top: newScrollY,
            behavior: "auto",
          });
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < transitionDuration) {
          animationFrameId = requestAnimationFrame(
            maintainScrollDuringTransition
          );
        }
      }
    };

    // Start maintaining scroll position during transition
    animationFrameId = requestAnimationFrame(maintainScrollDuringTransition);

    // After CSS transition completes, scroll the header to the top of the viewport
    const transitionTimeout = setTimeout(() => {
      if (headerRef.current) {
        // Use requestAnimationFrame to ensure DOM is fully settled after transition
        requestAnimationFrame(() => {
          if (headerRef.current) {
            // Scroll to position header below the sticky nav
            scrollHeaderIntoView("smooth");
          }
        });
      }
      referencePointRef.current = null;
    }, transitionDuration);

    return () => {
      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
      clearTimeout(transitionTimeout);
    };
  }, [isExpanded, scrollHeaderIntoView]);

  return (
    <div className="mb-4 rounded-2xl border border-neutral-200 bg-white shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
      <button
        ref={headerRef}
        onClick={onToggle}
        className="w-full rounded-2xl bg-white p-6 text-left transition-all duration-200 hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800 lg:p-8"
        aria-expanded={isExpanded}
        aria-controls={`accordion-content-${id}`}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} section ${typeof title === "string" ? title : id}`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            {title}
          </h2>
          <span className="text-2xl font-bold text-neutral-600 dark:text-neutral-300">
            {isExpanded ? "−" : "+"}
          </span>
        </div>
      </button>
      <div
        id={`accordion-content-${id}`}
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          // If expanded but height not measured yet, use a large value temporarily
          // The ResizeObserver will update it with the actual height
          maxHeight: isExpanded
            ? maxHeight > 0
              ? `${maxHeight}px`
              : "9999px"
            : "0px",
          opacity: isExpanded ? 1 : 0,
        }}
        aria-hidden={!isExpanded}
      >
        <div
          ref={innerContentRef}
          className={`border-t border-neutral-200 p-6 dark:border-neutral-700 lg:p-8 ${
            contentClassName ?? ""
          }`}
        >
          <LazyAccordionContent isExpanded={isExpanded}>
            {children}
          </LazyAccordionContent>
        </div>
      </div>
    </div>
  );
};
