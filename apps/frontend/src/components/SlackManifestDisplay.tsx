import type { FC } from "react";

import type { SlackManifestResponse } from "../utils/api";

interface SlackManifestDisplayProps {
  manifestData: SlackManifestResponse;
  onCopy: () => void;
}

export const SlackManifestDisplay: FC<SlackManifestDisplayProps> = ({
  manifestData,
  onCopy,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Webhook URL
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            readOnly
            value={manifestData.webhookUrl}
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
          <button
            onClick={onCopy}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Copy
          </button>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            App Manifest JSON
          </label>
          <button
            onClick={onCopy}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Copy Manifest
          </button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-50">
            Show manifest
          </summary>
          <div className="mt-1">
            <textarea
              readOnly
              value={JSON.stringify(manifestData.manifest, null, 2)}
              rows={20}
              className="w-full rounded-md border border-neutral-300 bg-white p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
          </div>
        </details>
      </div>
      <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <h4 className="mb-2 text-sm font-bold text-red-900 dark:text-red-200">
          ⚠️ CRITICAL: Webhook URL Must Be Updated
        </h4>
        <p className="mb-2 text-sm text-red-800 dark:text-red-300">
          The webhook URL in the manifest contains a placeholder (<code className="rounded bg-red-100 px-1 dark:bg-red-900">PLACEHOLDER_INTEGRATION_ID</code>).
        </p>
        <p className="mb-2 text-sm text-red-800 dark:text-red-300">
          <strong>What to expect:</strong> When you create the Slack app from this manifest, Slack will show an error for the webhook URL. This is <strong>EXPECTED and NORMAL</strong>.
        </p>
        <p className="text-sm text-red-800 dark:text-red-300">
          <strong>What you must do:</strong> After creating the integration (step 8), you&apos;ll see the real webhook URL. You <strong>MUST</strong> update it in your Slack app&apos;s &quot;Event Subscriptions&quot; settings, or the bot will not work.
        </p>
      </div>
      <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
        <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
          Setup Instructions
        </h4>
        <ol className="list-inside list-decimal space-y-1 max-h-64 overflow-y-auto text-sm text-blue-800 dark:text-blue-300">
          {manifestData.instructions.map((instruction, index) => (
            <li key={index} dangerouslySetInnerHTML={{ __html: instruction.replace(/'/g, "&apos;").replace(/"/g, "&quot;") }} />
          ))}
        </ol>
      </div>
    </div>
  );
};
