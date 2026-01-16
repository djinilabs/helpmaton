import type { Components } from "react-markdown";

/**
 * Stable markdown components object that doesn't change between renders.
 * This prevents ReactMarkdown from re-rendering unnecessarily.
 */
export const markdownComponents: Components = {
  code: (props) => {
    const { className, children, ...rest } = props;
    const isInline = !className || !className.includes("language-");
    if (isInline) {
      return (
        <code
          className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        {...rest}
      >
        {children}
      </code>
    );
  },
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
};
