// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import * as React from "react";
import { Slot as SlotPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-foreground/[0.08] backdrop-blur-[2px] text-foreground/90 hover:bg-foreground/[0.14] hover:text-foreground active:bg-foreground/[0.18] border border-foreground/[0.06]",
        primary:
          "bg-primary text-primary-foreground hover:brightness-110 active:brightness-90 font-medium",
        "primary-gradient":
          "bg-primary text-primary-foreground hover:brightness-110 active:brightness-90 font-medium",
        destructive:
          "border border-destructive/25 text-destructive/90 hover:bg-destructive/[0.08] hover:text-destructive active:bg-destructive/[0.14]",
        outline:
          "border border-foreground/[0.12] bg-transparent text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.10]",
        secondary:
          "bg-secondary/60 backdrop-blur-[2px] text-secondary-foreground border border-foreground/[0.06] hover:bg-secondary/80 active:bg-secondary",
        ghost: "text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.10]",
        text: "bg-transparent p-0 rounded-none text-foreground/80 hover:text-foreground transition-colors",
        link: "text-primary/80 hover:text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5 text-[13px]",
        sm: "h-7 rounded-md px-3 text-xs",
        lg: "h-10 rounded-xl px-8",
        icon: "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? SlotPrimitive.Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
