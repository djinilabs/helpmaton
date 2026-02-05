import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, type FC, type ReactNode } from "react";

const SCROLL_LOAD_THRESHOLD = 5;

export interface VirtualListProps<T> {
  /** Ref to the scrollable container (e.g. from ScrollContainer) */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  items: T[];
  /** Estimated row height in px. Used for variable-height lists. */
  estimateSize?: (index: number) => number;
  /** Fixed row height in px. If set, overrides estimateSize. */
  rowHeight?: number;
  /** Render a single row. Receives item and index. */
  renderRow: (item: T, index: number) => ReactNode;
  /** Stable key for each item (e.g. item.id). Default: index. */
  getItemKey?: (index: number, item: T) => string | number;
  /** Infinite scroll: there are more pages. */
  hasNextPage?: boolean;
  /** Infinite scroll: currently fetching next page. */
  isFetchingNextPage?: boolean;
  /** Infinite scroll: load next page. */
  fetchNextPage?: () => void;
  /** Empty state when items.length === 0 */
  empty?: ReactNode;
}

export function VirtualList<T>({
  scrollRef,
  items,
  estimateSize,
  rowHeight,
  renderRow,
  getItemKey,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  empty,
}: VirtualListProps<T>): ReturnType<FC> {
  const count = items.length;
  const estimate = rowHeight != null ? () => rowHeight : (estimateSize ?? (() => 120));
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimate,
    getItemKey: getItemKey == null ? undefined : (index) => String(getItemKey(index, items[index]!)),
    overscan: 5,
    useFlushSync: false,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]?.index ?? -1 : -1;

  // Trigger fetch when user scrolls near the end
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage || count === 0) return;
    if (lastIndex >= count - SCROLL_LOAD_THRESHOLD) {
      fetchNextPage();
    }
  }, [lastIndex, count, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (count === 0 && empty != null) {
    return <>{empty}</>;
  }

  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      style={{
        height: `${totalSize}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item == null) return null;
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(item, virtualRow.index)}
          </div>
        );
      })}
      {hasNextPage && isFetchingNextPage && (
        <div
          style={{
            position: "absolute",
            top: totalSize,
            left: 0,
            width: "100%",
            padding: "0.75rem",
            textAlign: "center" as const,
            fontSize: "0.875rem",
            color: "var(--color-neutral-500, #737373)",
          }}
        >
          Loading more…
        </div>
      )}
    </div>
  );
}
