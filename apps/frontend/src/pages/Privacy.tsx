import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { legalMarkdownComponents } from "../components/LegalMarkdownComponents";
import privacyMarkdown from "../legal/privacy.md?raw";

const Privacy: FC = () => {
  return (
    <div className="size-full bg-neutral-50 px-6 py-10 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border-2 border-neutral-200 bg-white p-8 shadow-large dark:border-neutral-800 dark:bg-surface-50 sm:p-10">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={legalMarkdownComponents}
          >
            {privacyMarkdown}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default Privacy;

