import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Material Design 3 button system.
 * Variants map 1:1 to the M3 spec: filled, tonal (secondary-container),
 * outlined, text, elevated. Shape is a full pill (M3 "high" shape),
 * height 40/32/48 (sm/default/lg), label-large typography, and every
 * variant carries an M3 state layer (hover 8% / press 10% of content
 * color) via the .state-layer utility in globals.css.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-label-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 select-none state-layer m3-press transition-[background-color,border-color,box-shadow,color] duration-200",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-on-primary hover:elevation-1",
        tonal:
          "bg-secondary-container text-on-secondary-container hover:elevation-1",
        outlined:
          "border border-outline text-primary bg-transparent hover:bg-primary/8",
        text:
          "bg-transparent text-primary px-4",
        elevated:
          "bg-surface-low text-primary elevation-1 hover:elevation-2",
        destructive:
          "bg-error text-on-error hover:elevation-1",
        ghost:
          "bg-transparent text-on-surface-variant hover:bg-on-surface/8",
        link: "bg-transparent text-primary underline-offset-4 hover:underline rounded-sm",
      },
      size: {
        default: "h-10 px-6",
        sm: "h-8 px-4 text-label-md",
        lg: "h-12 px-8 text-label-lg",
        icon: "h-10 w-10",
        iconSm: "h-8 w-8 [&_svg]:size-4",
        iconLg: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
