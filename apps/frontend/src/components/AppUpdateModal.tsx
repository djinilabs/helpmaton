import { useEffect, type FC } from "react";

import { BrandName } from "./BrandName";
import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface AppUpdateModalProps {
  isOpen: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  onClose: () => void;
  onUpgrade: () => void;
}

export const AppUpdateModal: FC<AppUpdateModalProps> = ({
  isOpen,
  currentVersion,
  latestVersion,
  onClose,
  onUpgrade,
}) => {
  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic">
        <h2 className="mb-6 text-3xl font-bold text-neutral-900">
          Update Available
        </h2>
        <p className="mb-4 text-lg font-medium text-neutral-700">
          A newer version of <BrandName /> is available. Reload to get the
          latest improvements.
        </p>
        {(currentVersion || latestVersion) && (
          <p className="mb-6 text-sm text-neutral-600">
            {currentVersion ? `Current: ${currentVersion}` : ""}
            {currentVersion && latestVersion ? " · " : ""}
            {latestVersion ? `New: ${latestVersion}` : ""}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onUpgrade}
            className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored"
          >
            Update
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
