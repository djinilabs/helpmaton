import type { FC } from "react";

import { useEscapeKey } from "../hooks/useEscapeKey";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

export const UpgradeModal: FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgrade,
}) => {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic">
        <h2 className="mb-6 text-3xl font-bold text-neutral-900">
          Upgrade Now
        </h2>
        <p className="mb-6 text-lg font-medium text-neutral-700">
          Loving the agent? Upgrade now to keep it running without interruption.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onUpgrade}
            className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored"
          >
            Upgrade
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};
