import type { Components } from "react-markdown";

import { markdownComponents } from "./ChatMarkdownComponents";

export const legalMarkdownComponents: Components = {
  ...markdownComponents,
  h1: ({ children }) => (
    <h1 className="mb-4 text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-xl font-bold text-neutral-900 dark:text-neutral-50">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-inside list-disc space-y-1 text-neutral-800 dark:text-neutral-200">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-inside list-decimal space-y-1 text-neutral-800 dark:text-neutral-200">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="font-semibold text-primary-700 underline decoration-2 underline-offset-2 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-xl border-l-4 border-neutral-300 bg-neutral-50 p-4 text-neutral-700 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-300">
      {children}
    </blockquote>
  ),
};

