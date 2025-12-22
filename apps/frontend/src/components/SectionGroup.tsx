import type { FC, ReactNode } from "react";

interface SectionGroupProps {
  title: string;
  children: ReactNode;
}

export const SectionGroup: FC<SectionGroupProps> = ({ title, children }) => {
  return (
    <section className="bg-neutral-50/50 border border-neutral-200 rounded-2xl p-4 lg:p-6 mb-8 dark:bg-neutral-800/50 dark:border-neutral-700">
      <h2 className="text-lg font-bold text-neutral-900 tracking-tight mb-4 uppercase dark:text-neutral-50">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
};
