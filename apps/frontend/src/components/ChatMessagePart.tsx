import { ChartBarIcon, PaperClipIcon } from "@heroicons/react/24/outline";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownComponents } from "./ChatMarkdownComponents";

interface TextPartProps {
  text: string;
  isUser: boolean;
}

export const TextPart = memo<TextPartProps>(({ text, isUser }) => {
  if (isUser) {
    return <div className="whitespace-pre-wrap break-words">{text}</div>;
  }
  if (!text.trim()) {
    return null;
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
});
TextPart.displayName = "TextPart";

interface ReasoningPartProps {
  text: string;
  isWidget: boolean;
}

export const ReasoningPart = memo<ReasoningPartProps>(({ text, isWidget }) => {
  if (isWidget) {
    return null;
  }
  // Skip redacted reasoning - don't display it
  // Check if text is exactly "[REDACTED]" or contains it (likely at the end)
  const trimmedText = text.trim();
  if (
    trimmedText === "[REDACTED]" ||
    trimmedText.endsWith("\n\n[REDACTED]") ||
    trimmedText.endsWith("\n[REDACTED]")
  ) {
    return null;
  }
  // Remove [REDACTED] marker if present in the text
  let cleanedText = text;
  cleanedText = cleanedText.replace(/\n*\s*\[REDACTED\]\s*$/g, "").trim();
  // If after cleaning the text is empty, skip it
  if (!cleanedText) {
    return null;
  }
  return (
    <div className="max-w-[80%] overflow-x-auto rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200">
          🧠 Reasoning
        </summary>
        <div className="mt-2">
          <div className="overflow-x-auto rounded bg-indigo-100 p-2 text-sm text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {cleanedText}
            </ReactMarkdown>
          </div>
        </div>
      </details>
    </div>
  );
});
ReasoningPart.displayName = "ReasoningPart";

interface FilePartProps {
  fileUrl: string;
  mediaType?: string;
  partIndex: number;
  messageId: string;
}

export const FilePart = memo<FilePartProps>(
  ({ fileUrl, mediaType, partIndex, messageId }) => {
    const isImage =
      (mediaType && mediaType.startsWith("image/")) ||
      !!fileUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);

    if (isImage) {
      return (
        <div key={`${messageId}-part-${partIndex}`} className="mt-2 max-w-full">
          <img
            src={fileUrl}
            alt="Uploaded image"
            className="max-h-96 max-w-full rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
            }}
          />
        </div>
      );
    }

    const fileName = fileUrl.split("/").pop()?.split("?")[0] || "File";
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="mt-2 flex items-center gap-2 rounded-lg border-2 border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-surface-100"
      >
        <PaperClipIcon className="size-5 shrink-0 text-neutral-600 dark:text-neutral-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {fileName}
          </div>
          {mediaType && (
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              {mediaType}
            </div>
          )}
        </div>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border-2 border-primary-600 bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:bg-primary-700 dark:border-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          Download
        </a>
      </div>
    );
  }
);
FilePart.displayName = "FilePart";

interface ToolPartProps {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
  state?: string;
  isWidget?: boolean;
  partIndex: number;
  messageId: string;
}

export const ToolPart = memo<ToolPartProps>(
  ({
    toolName,
    input,
    output,
    errorText,
    state,
    partIndex,
    messageId,
    isWidget,
  }) => {
    if (isWidget) {
      return null;
    }
    const hasOutput = output !== undefined;
    const hasError = !!errorText;

    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="max-w-[80%] overflow-x-auto rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
      >
        <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
          🔧 Tool Call: {toolName}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
            {toolName}
          </span>
          {state && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
              ({state})
            </span>
          )}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            View {hasOutput ? "output" : hasError ? "error" : "arguments"}
          </summary>
          <div className="mt-2 space-y-2">
            <div>
              <div className="mb-1 font-medium text-blue-700 dark:text-blue-300">
                Arguments:
              </div>
              <pre className="overflow-x-auto rounded bg-blue-100 p-2 text-xs dark:bg-blue-900 dark:text-blue-50">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            {hasOutput && (
              <div>
                <div className="mb-1 font-medium text-green-700 dark:text-green-300">
                  Output:
                </div>
                {typeof output === "string" ? (
                  <div className="rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {output}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                    {JSON.stringify(output, null, 2)}
                  </pre>
                )}
              </div>
            )}
            {hasError && (
              <div>
                <div className="mb-1 font-medium text-red-700 dark:text-red-300">
                  Error:
                </div>
                <div className="rounded bg-red-100 p-2 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">
                  {errorText}
                </div>
              </div>
            )}
          </div>
        </details>
      </div>
    );
  }
);
ToolPart.displayName = "ToolPart";

interface SourceUrlPartProps {
  sourceId: string;
  url: string;
  title?: string;
  partIndex: number;
  messageId: string;
}

export const SourceUrlPart = memo<SourceUrlPartProps>(
  ({ url, title, partIndex, messageId }) => {
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="max-w-[80%] overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
      >
        <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          📎 Source
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sm text-amber-900 underline hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-300"
        >
          {title || url}
        </a>
      </div>
    );
  }
);
SourceUrlPart.displayName = "SourceUrlPart";

interface SourceDocumentPartProps {
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
  partIndex: number;
  messageId: string;
}

export const SourceDocumentPart = memo<SourceDocumentPartProps>(
  ({ mediaType, title, filename, partIndex, messageId }) => {
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="max-w-[80%] overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
      >
        <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          📄 Document Source
        </div>
        <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
          {title}
        </div>
        {filename && (
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {filename}
          </div>
        )}
        <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {mediaType}
        </div>
      </div>
    );
  }
);
SourceDocumentPart.displayName = "SourceDocumentPart";

interface DataPartProps {
  dataName: string;
  data: unknown;
  id?: string;
  partIndex: number;
  messageId: string;
}

export const DataPart = memo<DataPartProps>(
  ({ dataName, data, partIndex, messageId }) => {
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="max-w-[80%] overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <ChartBarIcon className="size-3" />
          Data: {dataName}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
            View data
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-900 dark:text-slate-50">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      </div>
    );
  }
);
DataPart.displayName = "DataPart";

interface StepStartPartProps {
  partIndex: number;
  messageId: string;
}

export const StepStartPart = memo<StepStartPartProps>(
  ({ partIndex, messageId }) => {
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="my-2 flex max-w-[80%] items-center gap-2"
      >
        <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600"></div>
        <div className="px-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Step
        </div>
        <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600"></div>
      </div>
    );
  }
);
StepStartPart.displayName = "StepStartPart";

interface UnknownPartProps {
  partType: string;
  part: unknown;
  partIndex: number;
  messageId: string;
}

export const UnknownPart = memo<UnknownPartProps>(
  ({ partType, part, partIndex, messageId }) => {
    return (
      <div
        key={`${messageId}-part-${partIndex}`}
        className="max-w-[80%] overflow-x-auto rounded-xl border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950"
      >
        <div className="mb-1 text-xs font-medium text-yellow-700 dark:text-yellow-300">
          Unknown part type: {partType}
        </div>
        <pre className="overflow-x-auto text-xs text-yellow-900 dark:text-yellow-100">
          {JSON.stringify(part, null, 2)}
        </pre>
      </div>
    );
  }
);
UnknownPart.displayName = "UnknownPart";
