import type { FC, ReactNode } from "react";

interface SectionGroupProps {
  title: string | ReactNode;
  children: ReactNode;
}

export const SectionGroup: FC<SectionGroupProps> = ({ title, children }) => {
  return (
    <section className="mb-8 rounded-2xl border border-neutral-200 bg-neutral-50/50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50 lg:p-6">
      <h2 className="mb-4 text-lg font-bold uppercase tracking-tight text-neutral-900 dark:text-neutral-50">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
};
