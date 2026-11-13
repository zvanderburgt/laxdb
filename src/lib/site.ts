/**
 * Site copy — the part of the page that has no feed behind it.
 *
 * These are defaults, not fixture data: an override in the CMS layer replaces any of them at boot, so
 * the hero can be rewritten without touching a component. Keep the strings here in sync with what
 * Home renders (they are the same words, moved out of JSX).
 */
export interface SiteCopy {
  heroEyebrow: string;
  heroTail: string;
  heroLede: string;
  /** an announcement line above the nav; empty means nothing is shown */
  banner: string;
}

export const SITE_DEFAULTS: SiteCopy = {
  heroEyebrow: "The lacrosse player database",
  heroTail: "One profile.",
  heroLede:
    "Field and box, from NCAA Division I, the MCLA and the PLL down through 16 Canadian box leagues — Junior A, Junior B, Junior C, Senior and the NLL. Career histories, position-aware metrics, side-by-side comparison.",
  banner: "",
};

/** Mutated in place by the override layer, like every other entity. */
export const site: SiteCopy = { ...SITE_DEFAULTS };
