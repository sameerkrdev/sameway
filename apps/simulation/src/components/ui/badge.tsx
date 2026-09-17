import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        outline: "border-[var(--border)] text-[var(--foreground)]",
        // Semantic states always pair with an icon and a text label at the call
        // site; colour alone never carries the meaning.
        pass: "border-transparent bg-[color-mix(in_oklab,var(--pass)_22%,transparent)] text-[var(--pass)]",
        fail: "border-transparent bg-[color-mix(in_oklab,var(--fail)_22%,transparent)] text-[var(--fail)]",
        warn: "border-transparent bg-[color-mix(in_oklab,var(--warn)_22%,transparent)] text-[var(--warn)]",
        skip: "border-transparent bg-[color-mix(in_oklab,var(--skip)_22%,transparent)] text-[var(--skip)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
