/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The icon set the storefront ships.
 *
 * Drawn on a 24×24 grid with a 2 px stroke, round caps and joins, inheriting `currentColor` so a
 * token decides the colour. Each icon takes a `label`; when one is supplied the SVG is an image
 * with a name, and when it is not the icon is decorative and hidden from a screen reader — the
 * two cases that actually matter, and no third.
 */

import type { ReactNode, SVGProps } from "react";

/** The shared frame: size, stroke and accessibility wiring in one place. */
function Icon({
  children,
  label,
  size = 24,
  ...rest
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly size?: number;
} & Omit<SVGProps<SVGSVGElement>, "children">): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined
        ? { "aria-hidden": true, focusable: "false" }
        : { role: "img", "aria-label": label })}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** A shopping bag: the cart affordance. */
export function CartIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M6 8h12l-1.2 11a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </Icon>
  );
}

/** A magnifier. */
export function SearchIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Icon>
  );
}

/** A map pin. */
export function PinIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

/** A clock. */
export function ClockIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

/** A star, filled when the rating is whole. */
export function StarIcon(props: { readonly label?: string; readonly size?: number; readonly filled?: boolean }): ReactNode {
  const { filled = false, ...rest } = props;
  return (
    <Icon {...rest} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8L12 3.6Z" />
    </Icon>
  );
}

/** A scooter: the delivery marker. */
export function ScooterIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8.5 17h7" />
      <path d="M6 14.5 8 9h3l2 5.5" />
      <path d="M13 9h4l1.5 5" />
    </Icon>
  );
}

/** A check mark. */
export function CheckIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5L20 6.5" />
    </Icon>
  );
}

/** A close mark. */
export function CloseIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

/** A plus. */
export function PlusIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** A minus. */
export function MinusIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

/** A person. */
export function UserIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  );
}

/** A receipt. */
export function ReceiptIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z" />
      <path d="M9 8h6M9 12h6" />
    </Icon>
  );
}

/** A chevron pointing right; rotate with CSS for other directions. */
export function ChevronIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

/** A warning triangle: used where the platform has to be honest about a limitation. */
export function WarningIcon(props: { readonly label?: string; readonly size?: number }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 10v4M12 17.2v.2" />
    </Icon>
  );
}
