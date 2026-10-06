import * as React from "react";
import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, onKeyDown, ...props }, ref) => (
  <span
    className={cn(
      "relative flex w-full items-center rounded-md border border-input bg-background shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring has-[select:disabled]:cursor-not-allowed has-[select:disabled]:opacity-50",
      className,
    )}
  >
    <select
      ref={ref}
      className="h-10 w-full appearance-none rounded-md bg-transparent py-2 pl-3 pr-9 text-sm outline-none disabled:cursor-not-allowed"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented) event.preventDefault();
      }}
      {...props}
    >
      {children}
    </select>
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="pointer-events-none absolute right-3 size-4 text-muted-foreground"
    >
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </span>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
