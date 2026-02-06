import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useState, type FC, type ReactNode } from "react";

const SCROLL_LOAD_THRESHOLD = 5;

export interface VirtualTableColumn<T> {
  key: string;
  header: ReactNode;
  /** Render cell content for this column */
  render: (item: T, index: number) => ReactNode;
  /** Optional column width (e.g. "120px", "1fr"). Default: auto */
  width?: string;
}

export interface VirtualTableProps<T> {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  columns: VirtualTableColumn<T>[];
  rows: T[];
  estimateSize?: (index: number) => number;
  rowHeight?: number;
  getItemKey?: (index: number, item: T) => string | number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  empty?: ReactNode;
}

export function VirtualTable<T>({
  scrollRef,
  columns,
  rows,
  estimateSize,
  rowHeight,
  getItemKey,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  empty,
}: VirtualTableProps<T>): ReturnType<FC> {
  const [scrollReady, setScrollReady] = useState(false);
  useLayoutEffect(() => {
    if (scrollRef.current && !scrollReady) setScrollReady(true);
  });

  const count = rows.length;
  const estimate = rowHeight != null ? () => rowHeight : (estimateSize ?? (() => 52));
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimate,
    getItemKey: getItemKey == null ? undefined : (index) => String(getItemKey(index, rows[index]!)),
    overscan: 5,
    useFlushSync: false,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]?.index ?? -1 : -1;

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
  const gridTemplateColumns = columns
    .map((c) => c.width ?? "1fr")
    .join(" ");

  const headerRowStyle = {
    gridTemplateColumns,
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  };

  // Before scroll element is measured, virtualizer can return 0 items; show all rows so table isn't empty and scroll works
  if (count > 0 && virtualItems.length === 0) {
    return (
      <div className="w-full" role="table" aria-rowcount={count}>
        <div
          className="grid border-b border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
          style={headerRowStyle}
          role="row"
        >
          {columns.map((col) => (
            <div
              key={col.key}
              className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50"
              role="columnheader"
            >
              {col.header}
            </div>
          ))}
        </div>
        {rows.map((item, i) => (
          <div
            key={getItemKey?.(i, item) ?? i}
            className="grid border-b border-neutral-200 dark:border-neutral-700"
            style={{ gridTemplateColumns }}
            role="row"
          >
            {columns.map((col) => (
              <div
                key={col.key}
                className="flex min-w-0 items-center px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300"
                role="gridcell"
              >
                {col.render(item, i)}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full" role="table" aria-rowcount={count}>
      {/* Sticky header: stays fixed at top of scroll container */}
      <div
        className="grid border-b border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
        style={headerRowStyle}
        role="row"
      >
        {columns.map((col) => (
          <div
            key={col.key}
            className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50"
            role="columnheader"
          >
            {col.header}
          </div>
        ))}
      </div>
      {/* Virtualized body */}
      <div
        style={{
          height: `${totalSize}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = rows[virtualRow.index];
          if (item == null) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full border-b border-neutral-200 dark:border-neutral-700"
              style={{
                gridTemplateColumns,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              role="row"
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className="flex min-w-0 items-center px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300"
                  role="gridcell"
                >
                  {col.render(item, virtualRow.index)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {hasNextPage && isFetchingNextPage && (
        <div
          className="px-4 py-3 text-center text-sm text-neutral-500 dark:text-neutral-400"
          role="row"
        >
          Loading more…
        </div>
      )}
    </div>
  );
}
