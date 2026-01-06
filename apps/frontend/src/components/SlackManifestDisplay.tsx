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
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          App Manifest JSON
        </label>
        <div className="mt-1">
          <textarea
            readOnly
            value={JSON.stringify(manifestData.manifest, null, 2)}
            rows={20}
            className="w-full rounded-md border border-neutral-300 bg-white p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
          <button
            onClick={onCopy}
            className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Copy Manifest
          </button>
        </div>
      </div>
      <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
        <h4 className="mb-2 text-sm font-semibold text-yellow-900 dark:text-yellow-200">
          ⚠️ Important Note
        </h4>
        <p className="text-sm text-yellow-800 dark:text-yellow-300">
          The webhook URL in the manifest contains a placeholder. After creating
          the integration, you'll see the real webhook URL and must update it in
          your Slack app's Event Subscriptions settings.
        </p>
      </div>
      <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
        <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
          Setup Instructions
        </h4>
        <ol className="list-inside list-decimal space-y-1 text-sm text-blue-800 dark:text-blue-300">
          {manifestData.instructions.map((instruction, index) => (
            <li key={index}>{instruction}</li>
          ))}
        </ol>
      </div>
    </div>
  );
};
