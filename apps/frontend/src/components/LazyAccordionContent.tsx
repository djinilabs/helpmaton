import { Suspense } from "react";
import type { FC, ReactNode } from "react";

import { LoadingScreen } from "./LoadingScreen";

interface LazyAccordionContentProps {
  isExpanded: boolean;
  children: ReactNode;
}

/**
 * Wrapper component that only renders children when the accordion is expanded.
 * This prevents React Query hooks and other side effects from executing
 * until the user opens the panel, reducing unnecessary network requests.
 * Also wraps children in Suspense to handle lazy-loaded components.
 */
export const LazyAccordionContent: FC<LazyAccordionContentProps> = ({
  isExpanded,
  children,
}) => {
  // Only render children when expanded to prevent queries from running
  if (!isExpanded) {
    return null;
  }

  return (
    <Suspense fallback={<LoadingScreen className="min-h-0 py-8" />}>
      {children}
    </Suspense>
  );
};
