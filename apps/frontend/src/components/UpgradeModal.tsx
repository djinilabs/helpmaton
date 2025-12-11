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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-dramatic border-2 border-neutral-300 p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold text-neutral-900 mb-6">
          Upgrade Now
        </h2>
        <p className="text-lg font-medium text-neutral-700 mb-6">
          Loving the agent? Upgrade now to keep it running without interruption.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onUpgrade}
            className="flex-1 bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-colors"
          >
            Upgrade
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};
