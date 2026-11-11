export type Anchor = {
  selector: string;
  label?: string | RegExp;
  within?: string;
  group?: string;
};

export type WalkStep = {
  anchor: Anchor;
  title: string;
  detail: string;
  /** Advance only when the next control or result is visible. */
  advance?: "visible" | "click" | "gone";
  /** Alternate control to observe when the highlighted element is explanatory. */
  action?: Anchor;
  /** Safe navigation control that the user may ask the guide to open. */
  assist?: boolean;
  optional?: boolean;
  external?: boolean;
  blocked?: string;
};

export type WalkArea = "common" | "forms" | "direct" | "hcmue" | "chinesetest" | "admin" | "knowledge" | "account";
export type WalkId = `${"CH" | "GF" | "HC" | "CT" | "QT" | "KT"}-${string}`;
export type Walkthrough = {
  id: WalkId;
  area: WalkArea;
  title: string;
  aliases: string[];
  steps: WalkStep[];
  fallback?: Pick<WalkStep, "anchor" | "detail">;
  admin?: boolean;
};

export const anchor = (selector: string, group?: string): Anchor => ({ selector, group });
export const controls = "button, a[href], summary, [role=tab]";
export const control = (label: string | RegExp, within?: string, group?: string): Anchor => ({ selector: controls, label, within, group });
export const step = (anchor: Anchor, title: string, detail: string, options?: Omit<WalkStep, "anchor" | "title" | "detail">): WalkStep =>
  ({ anchor, title, detail, ...options });
export const flow = (id: WalkId, area: WalkArea, title: string, aliases: string[], steps: WalkStep[], options?: Pick<Walkthrough, "fallback" | "admin">): Walkthrough =>
  ({ id, area, title, aliases, steps, ...options });
