import { useEffect } from "react";

/**
 * Hook to handle Escape key press to close modals/dialogs
 * @param isOpen - Whether the modal/dialog is currently open
 * @param onClose - Callback function to close the modal/dialog
 */
export const useEscapeKey = (isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);
};
