import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { markdownComponents, REMARK_PLUGINS } from "./ChatMarkdownComponents";

/** Max characters to render before truncating to avoid UI freeze. */
const MAX_DISPLAY_LENGTH = 5000;

function valueToDisplayString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

type Variant = "blue" | "green" | "red" | "slate" | "yellow";

const VARIANT_CLASSES: Record<
  Variant,
  { button: string; container: string; pre: string }
> = {
  blue: {
    button: "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
    container: "bg-blue-100 dark:bg-blue-900 dark:text-blue-50",
    pre: "bg-blue-100 dark:bg-blue-900 dark:text-blue-50",
  },
  green: {
    button: "text-green-700 dark:text-green-300",
    container: "bg-green-100 dark:bg-green-900 dark:text-green-50",
    pre: "bg-green-100 dark:bg-green-900 dark:text-green-50",
  },
  red: {
    button: "text-red-700 dark:text-red-300",
    container: "bg-red-100 dark:bg-red-900 dark:text-red-200",
    pre: "bg-red-100 dark:bg-red-900 dark:text-red-200",
  },
  slate: {
    button: "text-slate-600 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300",
    container: "bg-slate-100 dark:bg-slate-900 dark:text-slate-50",
    pre: "bg-slate-100 dark:bg-slate-900 dark:text-slate-50",
  },
  yellow: {
    button: "text-yellow-700 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-200",
    container: "bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-100",
    pre: "bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-100",
  },
};

interface TruncatedPayloadDisplayProps {
  value: unknown;
  label: string;
  format: "json" | "markdown";
  variant?: Variant;
  className?: string;
  preClassName?: string;
  onCopy?: () => void;
}

/**
 * Lazy-rendered, truncated display for large payloads (e.g. tool output).
 * Content is only stringified and rendered when expanded, and truncated to
 * MAX_DISPLAY_LENGTH to prevent UI freeze.
 */
export const TruncatedPayloadDisplay = memo<TruncatedPayloadDisplayProps>(
  ({
    value,
    label,
    format,
    variant = "green",
    className,
    preClassName,
    onCopy,
  }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const v = VARIANT_CLASSES[variant];

    if (!isExpanded) {
      return (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className={`cursor-pointer font-medium ${v.button} ${className ?? ""}`}
        >
          View {label}
        </button>
      );
    }

    const fullStr = valueToDisplayString(value);
    const truncated = fullStr.length > MAX_DISPLAY_LENGTH;
    const displayStr = truncated
      ? fullStr.slice(0, MAX_DISPLAY_LENGTH) +
        `\n\n… (${fullStr.length - MAX_DISPLAY_LENGTH} more characters)`
      : fullStr;

    const handleCopy = () => {
      navigator.clipboard.writeText(fullStr).then(
        () => {
          toast.success("Copied to clipboard");
          onCopy?.();
        },
        () => {
          toast.error("Failed to copy");
        }
      );
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-medium ${v.button}`}>{label}:</span>
          {(truncated || onCopy) && (
            <button
              type="button"
              onClick={handleCopy}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${v.pre} hover:opacity-90`}
              title="Copy full content"
            >
              <ClipboardDocumentIcon className="size-3.5" />
              Copy full
            </button>
          )}
        </div>
        {format === "markdown" ? (
          <div
            className={`overflow-x-auto rounded p-2 text-xs ${v.container} ${className ?? ""}`}
          >
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              components={markdownComponents}
            >
              {displayStr}
            </ReactMarkdown>
          </div>
        ) : (
          <pre
            className={`overflow-x-auto rounded p-2 text-xs ${v.pre} ${preClassName ?? ""}`}
          >
            {displayStr}
          </pre>
        )}
      </div>
    );
  }
);
TruncatedPayloadDisplay.displayName = "TruncatedPayloadDisplay";
