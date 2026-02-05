import { forwardRef, type Ref } from "react";

interface ScrollContainerProps {
  className?: string;
  children?: React.ReactNode;
  /** Use a smaller max height (e.g. inside modals). Default is 100vh. */
  maxHeight?: string | number;
}

/**
 * Scrollable container with max height of one screen (or custom).
 * Forwards a ref so parents can use it as the scroll element for useVirtualizer.
 */
export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
  function ScrollContainer(
    { className, children, maxHeight = "100vh" },
    ref: Ref<HTMLDivElement>
  ) {
    const style: React.CSSProperties = {
      maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
      overflow: "auto",
    };

    return (
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    );
  }
);
