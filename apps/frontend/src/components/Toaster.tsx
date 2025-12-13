import { type FC } from "react";
import { Toaster as SonnerToaster } from "sonner";

export const Toaster: FC = () => {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "border-2 border-neutral-300 rounded-xl bg-white text-neutral-900 shadow-large transition-all duration-200",
          title: "font-semibold",
          description: "font-normal opacity-80",
          success:
            "bg-success-50 border-success-400 text-success-900 shadow-colored",
          error:
            "bg-error-50 border-error-400 text-error-900 shadow-error",
          info: "bg-primary-50 border-primary-400 text-primary-900 shadow-colored",
          warning:
            "bg-amber-50 border-amber-400 text-amber-900 shadow-accent",
        },
      }}
    />
  );
};
