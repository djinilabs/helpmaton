import { useState } from "react";
import type { FC } from "react";

import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  getAvailableAvatars,
  getDefaultAvatar,
} from "../utils/avatarUtils";

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (avatar: string) => void;
  currentAvatar?: string | null;
}

export const AvatarSelector: FC<AvatarSelectorProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentAvatar,
}) => {
  const availableAvatars = getAvailableAvatars();
  const defaultAvatar = getDefaultAvatar();
  const [selectedAvatar, setSelectedAvatar] = useState<string>(
    currentAvatar || defaultAvatar
  );

  useEscapeKey(isOpen, onClose);

  const handleSelect = (avatar: string) => {
    setSelectedAvatar(avatar);
    // Automatically submit when avatar is selected
    onSelect(avatar);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <h2 className="mb-8 text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
          Select Avatar
        </h2>

        <div className="mb-6">
          <div className="mb-4 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Selected Avatar:
          </div>
          <div className="flex items-center">
            <img
              src={selectedAvatar}
              alt="Selected avatar"
              className="size-20 rounded-lg border-2 border-primary-500 object-contain"
            />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-4 gap-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
          {availableAvatars.map((avatar) => {
            const isSelected = selectedAvatar === avatar;
            return (
              <button
                key={avatar}
                type="button"
                onClick={() => handleSelect(avatar)}
                className={`transform rounded-lg border-2 p-2 transition-all duration-200 hover:scale-105 active:scale-95 ${
                  isSelected
                    ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                    : "border-neutral-300 bg-white hover:border-primary-400 dark:border-neutral-700 dark:bg-surface-100 dark:hover:border-primary-500"
                }`}
              >
                <img
                  src={avatar}
                  alt={`Avatar ${avatar.replace("/images/helpmaton_logo_", "").replace(".svg", "")}`}
                  className="size-full object-contain"
                />
              </button>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

