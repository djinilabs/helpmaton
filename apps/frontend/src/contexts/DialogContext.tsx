/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface DialogContextValue {
  registerDialog: () => void;
  unregisterDialog: () => void;
  dialogCount: number;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export const DialogProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [dialogCount, setDialogCount] = useState(0);

  const registerDialog = useCallback(() => {
    setDialogCount((prev) => prev + 1);
  }, []);

  const unregisterDialog = useCallback(() => {
    setDialogCount((prev) => Math.max(0, prev - 1));
  }, []);

  return (
    <DialogContext.Provider value={{ registerDialog, unregisterDialog, dialogCount }}>
      {children}
    </DialogContext.Provider>
  );
};

export const useDialogTracking = (): DialogContextValue => {
  const context = useContext(DialogContext);
  if (context === undefined) {
    throw new Error("useDialogTracking must be used within a DialogProvider");
  }
  return context;
};

