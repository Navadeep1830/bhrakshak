import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border border-edge bg-panel", className)} {...props} />
  )
);
Card.displayName = "Card";

const Badge = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", className)}
    {...props}
  />
);

export { Card, Badge };
