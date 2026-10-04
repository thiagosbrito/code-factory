import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn("rounded-xl border border-border bg-white shadow-sm", className)}
      {...props}
    />
  );
};
