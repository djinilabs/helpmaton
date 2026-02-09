import {
  ArrowTopRightOnSquareIcon,
  LightBulbIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { FC } from "react";

import type { SuggestionItem } from "../utils/api";
import type { SuggestionActionPayload } from "../utils/suggestionActions";

type SuggestionsBoxProps = {
  items: SuggestionItem[];
  title?: string;
  isDismissing?: boolean;
  onDismiss?: (id: string) => void;
  /** Resolve action for an item (label + sectionId or openEdit). */
  getAction?: (item: SuggestionItem) => SuggestionActionPayload | null;
  /** Called when user clicks "Go to X"; client expands section and scrolls or opens modal. */
  onGoToAction?: (action: SuggestionActionPayload) => void;
};

export const SuggestionsBox: FC<SuggestionsBoxProps> = ({
  items,
  title = "Suggestions",
  isDismissing = false,
  onDismiss,
  getAction,
  onGoToAction,
}) => {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-5 shadow-soft dark:border-neutral-700 dark:bg-surface-100/60">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
        <LightBulbIcon className="size-4" />
        {title}
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const action = getAction?.(item) ?? null;
          return (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-200"
            >
              <div className="flex items-start justify-between gap-3">
                <span>{item.text}</span>
                {onDismiss && (
                  <button
                    type="button"
                    onClick={() => onDismiss(item.id)}
                    disabled={isDismissing}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-semibold text-neutral-500 transition-colors hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-200"
                  >
                    <XMarkIcon className="size-3" />
                    Dismiss
                  </button>
                )}
              </div>
              {action && onGoToAction && (
                <button
                  type="button"
                  onClick={() => onGoToAction(action)}
                  className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  {"openEdit" in action ? "Open settings" : `Go to ${action.label}`}
                  <ArrowTopRightOnSquareIcon className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
