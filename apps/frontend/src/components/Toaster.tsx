import { type FC } from "react";
import { Toaster as SonnerToaster } from "sonner";

export const Toaster: FC = () => {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-neutral-200 rounded-xl bg-white text-neutral-900 shadow-medium",
          title: "font-semibold",
          description: "font-normal text-neutral-600",
          success: "bg-white border-green-200",
          error: "bg-white border-red-200",
          info: "bg-white border-blue-200",
          warning: "bg-white border-yellow-200",
        },
      }}
    />
  );
};
