import type { FC, HTMLAttributes } from "react";

export const BrandName: FC<HTMLAttributes<HTMLSpanElement>> = ({
  className = "",
  ...props
}) => (
  <span
    className={`text-brand-gradient ${className}`.trim()}
    {...props}
  >
    Helpmaton
  </span>
);
