---
name: LAXDB
description: The lacrosse player database — real records, editorial calm.
colors:
  varsity-blue: "#0071e3"
  varsity-blue-hover: "#0077ed"
  varsity-blue-night: "#0a84ff"
  varsity-blue-night-hover: "#3d9bff"
  ink: "#1d1d1f"
  graphite: "#5c5c62"
  pewter: "#737379"
  cool-paper: "#fbfbfd"
  chalk: "#f5f5f7"
  sheet: "#ffffff"
  hairline: "rgba(0, 0, 0, 0.08)"
  hairline-strong: "rgba(0, 0, 0, 0.14)"
  night: "#000000"
  night-soft: "#0b0b0c"
  charcoal: "#1c1c1e"
  charcoal-raised: "#242426"
  win-green: "#1d9a55"
  loss-red: "#e0322c"
  warning-amber: "#b26a00"
  goalie-violet: "#6a4cf0"
  fogo-rose: "#d61f4a"
  lsm-cyan: "#0071a8"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Inter, system-ui, "Helvetica Neue", Arial, sans-serif'
    fontSize: "clamp(38px, 4.9vw, 66px)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.042em"
  headline:
    fontSize: "clamp(34px, 4.2vw, 48px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Inter, system-ui, "Helvetica Neue", Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "0em"
  label:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "26px"
  pill: "980px"
spacing:
  3xs: "4px"
  2xs: "6px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
  3xl: "44px"
components:
  button-primary:
    backgroundColor: "{colors.varsity-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.varsity-blue-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "38px"
  chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
  card:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "11px"
    padding: "0 12px"
    height: "38px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    rounded: "{rounded.xs}"
    padding: "6px 11px"
  position-badge:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
    height: "21px"
---

# Design System: LAXDB

## Overview

**Creative North Star: "The Scouting Desk"**

A public record laid out the way a good scout keeps a desk: everything within reach, the evidence
legible, and nothing decorative competing with the number. The system is editorial at the top of a
page and instrumental inside the data — a large, confident headline earns attention, then tables,
stat strips and rank rows take over without asking for more. Cool paper is the desk; white sheets are
the documents on it; hairlines are the only structure. One varsity blue marks what can be acted on or
what ranks first.

The mood is editorial confidence, not sports-broadcast volume. Type does the expressive work through
scale and tight display tracking; color stays quiet and functional. Components are tactile and
confident: capsule buttons, sheets that lift 2–3px under the pointer, tinted state changes, a frosted
chrome that feels part of the page rather than bolted above it. Density is high, but every cluster
gets air, and tables scroll rather than compress.

Light and dark are equally finished surfaces. Dark mode is true black with charcoal documents, never a
washed grey inversion, and its shadows deepen instead of glowing.

**Key Characteristics:**
- Paper-and-ink surfaces separated by hairlines, not nested boxes.
- One chromatic brand color: varsity blue. Green, red and amber appear only when they mean something.
- A single system type family at editorial scale, with tabular numerals for every comparable figure.
- Restrained tactile depth: flat at rest, a 2–3px lift and a soft shadow on interaction.
- Data first: stat strips, sortable tables, rank rows, comparison columns, compact cards.
- Light and dark designed together; dark is true black, not grey.

## Colors

A near-monochrome paper-and-ink palette interrupted by a single varsity blue, with green, red and
amber reserved for outcome, warning and position semantics.

### Primary

- **Varsity Blue:** the only chromatic brand color. It marks primary actions, selected filters, active
  chart strokes, rank numbers, accent stat values, the best-game row edge, comparison bars and focus
  rings. Its hover step is slightly brighter, never darker. In dark mode it is replaced by a brighter
  night variant so it keeps the same apparent weight against charcoal.
- **Varsity Blue Night:** the dark-theme counterpart, used anywhere varsity blue appears in light mode.

### Secondary

- **Win Green:** wins, positive movement, made saves, good form.
- **Loss Red:** losses, negative movement, destructive affordances.
- **Warning Amber:** caution, missing coverage, secondary status.
- **Goalie Violet, FOGO Rose, LSM Cyan:** position-badge hues. These are taxonomic, not decorative;
  they never escape badges, small stat ticks or legend swatches.

### Neutral

- **Cool Paper:** the page canvas. Every page starts here, including the header's frosted tint.
- **Chalk:** inset and soft fills, table footers, mini stat tiles, segmented tracks, neutral badges.
- **Sheet:** cards, tables, the search field, the command palette and the compare tray.
- **Ink:** primary text and headings.
- **Graphite:** secondary copy, inactive navigation, card subtitles.
- **Pewter:** tertiary text, uppercase labels, table headers, footnotes.
- **Hairline and Hairline Strong:** dividers, card borders, input borders. Strong is for controls and
  interactive card hover, never for decoration.
- **Night, Night Soft, Charcoal, Charcoal Raised:** the dark-theme equivalents of canvas, inset, sheet
  and raised sheet.

**The One Varsity Rule.** Varsity blue is the only chromatic brand color, and it occupies well under a
tenth of any screen. If two elements on one surface are blue, one of them is probably wrong.

**The Paper Rule.** A card is a white sheet on cool paper, separated by a hairline. Never stack a
white card directly on another white card without a border; use Chalk for the inner surface instead.

## Typography

**Display Font:** the system stack — SF Pro on Apple devices, Segoe UI on Windows, Inter as fallback.
**Body Font:** the same stack. There is no second family.
**Label/Mono Font:** none; labels use the same stack with uppercase and open tracking. Numerals use
tabular figures, not a mono face.

**Character:** one family, many voices. At display size it is editorial and tightly tracked; at table
size it becomes utilitarian and compact. Number columns are always tabular so values line up
vertically, and uppercase labels open their tracking to stay legible at 10–11px.

### Hierarchy

- **Display** (650 weight, clamp 38–66px, 1.02 line height, -0.042em tracking): the home hero only.
  Balanced wrapping, maximum ~18 characters per line.
- **Headline** (600 weight, clamp 34–48px, 1.08 line height, -0.035em tracking): page titles, profile
  names, league and team names. Profile names may reach the low 50s.
- **Title** (600 weight, 16–30px): section headings use a 24–30px step; card titles sit at 16–20px
  with tighter tracking.
- **Body** (400 weight, 15px, 1.47 line height): interface copy and table text. Long-form prose opens
  to 1.62; a lead paragraph runs at 17px with slightly negative tracking.
- **Label** (600 weight, 10.5–11.5px, 0.07–0.09em tracking, uppercase): eyebrows, table headers, stat
  labels, form labels and footer headings.

**The Tabular Rule.** Every number that can be compared vertically is set with tabular figures
(`.num`). Never use proportional numerals in tables, stat strips, score lines or leadership values.

**The One Family Rule.** No display face, no mono face, no imported webfont. Hierarchy comes from
size, weight, tracking and case — never from a second family.

## Layout

The page model is one centred column, maximum 1180px, with a 24px desktop gutter that becomes 16px at
phone width. Pages use 44px of top padding and 88px of bottom padding; phones use 24px and 56px.
Sections repeat a 44px vertical rhythm, while grids use 16px gaps and card grids use 10–12px.

The home hero is a 1.08fr / 0.92fr split with a 48px gap, collapsing to one column at 1000px. The
player profile is the densest layout: a 1.85fr main column beside a rail of at least 260px, with a 16px
gap. The rail only becomes sticky when the viewport is tall enough to hold it (1400px and up); below
that it scrolls normally.

Breakpoints are driven by the content, not by device names: 1000px drops the profile to one column and
stacks the hero; 900px hides the desktop nav links; 760px and 640px carry the phone pass. At 640px the
gutter drops to 16px, card padding drops from 20px to 16px, the horizontal player rails become
scroll-snap rows that run to the screen edge, and touch targets grow to 34–40px.

Tables never squeeze. They keep a 13.5px body and a 10.5px uppercase header, and scroll horizontally
inside their sheet. On phones, low-value columns are removed rather than collapsed into unreadable
stacks.

**The One Gutter Rule.** The header, page body, profile hero and tab strip all share the same gutter:
24px on desktop, 16px on phones. A page must never show two different left margins.

## Elevation & Depth

Restrained tactile. Surfaces are flat sheets with hairline borders at rest; the shadow vocabulary is
soft, low-opacity and directional. Depth is mostly a response to state — interactive cards rise 2–3px
and strengthen their border and shadow on hover — with two deliberate exceptions: the hero card and
floating overlays are allowed to sit above the page at rest. Dark mode deepens shadows rather than
lightening them, and never uses a glow as elevation.

### Shadow Vocabulary

- **Ambient sheet** (`0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 14px -8px rgba(0, 0, 0, 0.14)`): the default
  for cards, tables and player cards at rest.
- **Working hover** (`0 2px 4px rgba(0, 0, 0, 0.04), 0 18px 40px -24px rgba(0, 0, 0, 0.28)`): a card
  under the pointer, the hero search field, the secondary hero card.
- **Lifted overlay** (`0 30px 70px -30px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.06)`): the hero
  composition, command palette and compare tray — anything floating over the page.

**The Lift-Only-When-Asked Rule.** At rest, a surface is a hairline sheet. It earns a shadow only by
being interactive, floating, or deliberately staged in the hero. Never add a shadow to a static
section merely to separate it.

## Shapes

The form language is a sheet with gently curved corners: large cards, tables and the hero card use the
20px step (the hero card and feature band step up to 24–26px); compact cards, fields and the compare
picker use the 14px step; badges and small controls use the 6–10px steps. Buttons and chips are full
capsules; segmented controls are an 11px outer track with 8px inner pills.

Borders are always a single hairline. Dashed borders appear only where a slot is empty — the
"add a third player" comparison cell — never as a decorative frame. Avatars are squircle-ish, with a
radius equal to 28% of their size; team crests use 13px, or 26px at the extra-large profile size.
Hover lifts must not be clipped: horizontal rails carry padding above the cards to leave room for the
2–3px rise and its shadow.

## Components

### Buttons

- **Shape:** full capsule, 38px tall, 18px horizontal padding, 14px/500 label with a touch of negative
  tracking.
- **Primary:** varsity blue fill, white label. The only button that carries the brand color.
- **Secondary:** sheet fill, ink label, strong hairline border. Used beside a primary action.
- **Ghost:** transparent, graphite label, tinted hover fill. Used inside chrome and trays.
- **Hover / Focus:** background shifts one step; focus is a 2px varsity-blue outline with 2px offset.
- **Active:** scales to 0.975 — a press, not a bounce.
- **Small:** 32px tall, 14px padding, 13px label.

### Chips

- **Style:** capsule, sheet fill, hairline border, 13px/500 graphite label, 6×13px padding.
- **State:** hover lifts 1px, darkens the border and brings the label to ink. Chips form a two- or
  three-column grid in the hero rather than a ragged wrapped row, and truncate with an ellipsis rather
  than widen their column.

### Cards / Containers

- **Corner Style:** 20px for sheets; 14px for compact rows and fields; 24px for the hero card.
- **Background:** sheet on cool paper. Nested surfaces use Chalk, never another white.
- **Shadow Strategy:** ambient sheet at rest; working hover on interactive cards only.
- **Border:** 1px hairline; strong hairline on hover for interactive cards.
- **Internal Padding:** 20px desktop, 16px phone; card toolbars follow the same inset.
- **Hover:** interactive cards rise 3px and move to the working-hover shadow; static cards never move.

### Inputs / Fields

- **Style:** 38px tall, 11px radius, sheet fill, hairline border, graphite placeholder.
- **Hero search:** 54px tall, 16px radius, working-hover shadow at rest, 15.5px text.
- **Focus:** border becomes varsity blue plus a 3px accent-soft ring (4px on the hero field). No outer
  glow, no color shift in the field itself.
- **Selects:** same 38px/11px geometry with a chevron painted as an inline SVG, so they match inputs
  across platforms.

### Segmented Control

A Chalk-grey track with 3px padding and 11px radius. The selected segment becomes a sheet-white pill
with a 1px shadow and 600 weight; the unselected segments stay transparent with graphite labels. In
dark mode the selected pill becomes Charcoal Raised. On narrow screens the track scrolls horizontally
rather than compressing labels, and it may wrap where the labels are long.

### Tables

The signature data surface. A sheet container, 13.5px body, 10.5px uppercase headers with 0.07em
tracking, 10–14px cell padding and a hairline under every row. Numeric columns are right-aligned and
tabular; row hover is a 3% ink tint; the sorted header takes ink and a small varsity-blue caret. The
footer row is Chalk with a stronger top rule. A wide table scrolls inside its sheet, and on phones
lower-value columns are hidden rather than crushed.

### Navigation

A 54px sticky bar in frosted Cool Paper — 20px blur with 180% saturation — that only reveals its
bottom hairline after the page scrolls. Links are 13.5px/500 graphite, with a tinted capsule and 600
weight for the active route. The wordmark is 16px/700 with a 26px gradient mark. Below 900px the link
row is hidden and the search control collapses to an icon; the theme toggle stays.

### Position Badge

A 21px-tall, 6px-radius taxonomy label at 10.5px/700 with 0.04em tracking. Each position has a tinted
background and matching text: attack uses varsity blue, midfield green, defense amber, goalie violet,
FOGO rose, LSM cyan; generic field players stay neutral. This is the one place several hues coexist,
and it stays inside table cells and player cards.

### Hero Player Card

The staged exception to the flat-at-rest rule: a 24px-radius sheet on the lifted-overlay shadow, with
a four-stat strip separated by a hairline and a small secondary card beneath it. On phones the
secondary card and decorative SVG are removed and the four headline numbers compress into one row, so
the first real content arrives within about one screen.

### Command Palette

A centred 560px sheet with an 18px radius and the lifted-overlay shadow, over a 28%-black blurred
overlay. The input row is 16px, results are 10px-radius rows with a tinted varsity-blue active state,
and the footer carries keyboard hints. It opens on ⌘K / Ctrl+K and is the fastest path to any entity.

### Compare Tray

A fixed frosted bar at the bottom centre, 16px radius, with the lifted-overlay shadow. It carries
compact avatars, removable names, and one varsity-blue action. On phones it spans the full width with
12px side insets and drops the avatar row, keeping only the actions.

## Do's and Don'ts

### Do:

- **Do** use one 1180px column, 24px desktop gutters and 16px phone gutters; keep every page family on
  the same left margin.
- **Do** use the system font stack. Create hierarchy with size, weight, tracking and case.
- **Do** set every comparable figure in tabular numerals, right-align numeric columns and print the
  qualification minimum beside the number it qualifies.
- **Do** build surfaces as a hairline sheet with the 20px radius and ambient shadow; use Chalk for any
  nested surface.
- **Do** keep varsity blue for action, selection, rank and chart emphasis, and keep green, red, amber
  and the position hues semantic.
- **Do** let interactive cards lift 2–3px and move to the working-hover shadow; leave static cards
  still.
- **Do** grow touch targets to 34–40px on phones and hide low-value table columns instead of squeezing
  them.
- **Do** use the frosted treatment only for chrome and floating controls: nav, palette overlay, compare
  tray.
- **Do** use the standard ease (`cubic-bezier(0.22, 1, 0.36, 1)`) for state changes, keep motion in the
  0.18–0.5s range, and honor `prefers-reduced-motion`.

### Don't:

- **Don't** build dense stats-reference walls: 11px everything, underlined links, no breathing room
  between rows.
- **Don't** use neon sportsbook energy: black canvas, fluorescent accents, odds-board density or
  aggressive motion.
- **Don't** use generic SaaS glass: gradient blobs behind every section, floating glass cards, an
  interchangeable startup hero.
- **Don't** reproduce Elite Prospects' interface density or chrome.
- **Don't** introduce another chromatic brand color. Semantic status and position hues are not
  decoration.
- **Don't** stack a shadow, a decorative gradient and a border on the same card.
- **Don't** set display type at default tracking; large headings need roughly -0.03 to -0.042em.
- **Don't** let a wide table widen its grid track. Give it `min-width: 0` and scroll it.
- **Don't** mix the legacy `--line`, `--surface` and `--surface-2` aliases into new work; the current
  tokens are `--hairline`, `--hairline-strong`, `--card` and `--card-2`.
