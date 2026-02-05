import type { FC, ReactNode } from "react";

interface SectionGroupProps {
  title: string | ReactNode;
  children: ReactNode;
  /** When true, uses tighter padding (e.g. for sections that contain full-bleed content like the agent chat). */
  compact?: boolean;
}

export const SectionGroup: FC<SectionGroupProps> = ({
  title,
  children,
  compact = false,
}) => {
  return (
    <section
      className={`mb-8 w-full rounded-2xl border border-neutral-200 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-800/50 ${compact ? "p-2 lg:p-3" : "p-4 lg:p-6"}`}
    >
      <h2 className="mb-4 text-lg font-bold uppercase tracking-tight text-neutral-900 dark:text-neutral-50">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
};
