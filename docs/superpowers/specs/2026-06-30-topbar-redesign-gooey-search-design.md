---
title: TopBar Redesign — GooeyNav + Collapsible Search
date: 2026-06-30
status: approved
---

## Overview

Redesign the TopBar to feel more spacious and polished: taller bar, better-spaced back button, collapsible search with leftward-expand animation, and GooeyNav replacing the plain tab buttons.

---

## 1. Layout & Sizing

| Element | Before | After |
|---------|--------|-------|
| TopBar height | 44px | 52px |
| Back button size | 28×28px | 34×34px |
| Back button icon | 16×16 | 18×18 |
| Left padding (traffic lights) | `80px` | `88px` |
| Back button left margin | 0 | `8px` |
| Search collapsed width | 180px (always visible) | 88px |
| Search expanded width | 240px (on focus) | 260px (on click/focus) |

The net back-button offset from window edge increases by ~16px, visually detaching it from the traffic lights.

---

## 2. Collapsible Search Bar

**Collapsed state (default)**
- Width: 88px
- Content: search icon (13×13) + static text "搜索…" (non-interactive label)
- Style: `background: var(--glass-bg-base)`, `border: 1px solid var(--sm-border)`, `border-radius: 8px`

**Expand trigger**: `onClick` on the container sets `isExpanded = true`, then auto-focuses the `<input>`

**Expand animation**
- `width: 88px → 260px`
- `transition: width 0.35s var(--sm-ease-out)`
- Right edge is anchored (element is right-aligned via `margin-left: auto`), so the box grows leftward naturally
- Search icon remains as a prefix icon inside the expanded input

**Collapse trigger**: `onBlur` on `<input>` when `keyword === ''`, after 150ms delay (prevents closing while clicking a result)

**Expanded state**
- Shows full `<input>` with placeholder "搜索歌曲、歌手…"
- Dropdown behavior unchanged from current implementation

---

## 3. GooeyNav Component

### File structure

```
src/components/Layout/
  GooeyNav.tsx      ← new
  GooeyNav.css      ← new
  TopBar.tsx        ← modified
  TopBar.module.css ← modified
```

### GooeyNav.tsx changes vs. upstream source

1. **`onSelect?: (index: number) => void`** prop added — called inside `handleClick` after `setActiveIndex`
2. **`activeIndex?: number`** prop added (controlled mode) — when provided, overrides internal state; used by TopBar to keep nav in sync when navigating via other paths (e.g. back button landing on `explore`)
3. **`e.preventDefault()`** added at the start of `handleClick` — prevents `href="#"` from triggering hash navigation in the SPA/Electron context

### Color tokens in GooeyNav.css

```css
.gooey-nav-container {
  --color-1: white;
  --color-2: white;
  --color-3: white;
  --color-4: white;
}
```

Active pill: white background, text turns black — consistent with glass design system.

### TopBar wiring

```tsx
const navIndex = currentView === 'library' ? 1 : 0

<GooeyNav
  items={[
    { label: '探索', href: '#' },
    { label: '我的库', href: '#' },
  ]}
  activeIndex={navIndex}
  onSelect={(i) => navigateTo(i === 0 ? 'explore' : 'library')}
  particleCount={12}
  colors={[1, 1, 2, 1, 2, 1]}
/>
```

`activeIndex` is derived from `currentView` (Zustand), so back-button navigation and direct `navigateTo` calls both update GooeyNav automatically.

The old `.tab` / `.tabActive` CSS and `NAV_TABS.map(...)` JSX are removed.

---

## 4. Files Changed

| File | Action |
|------|--------|
| `src/components/Layout/TopBar.tsx` | Resize bar/button, add search collapse logic, wire GooeyNav |
| `src/components/Layout/TopBar.module.css` | Update heights, button sizes, search width/transition |
| `src/components/Layout/GooeyNav.tsx` | New — upstream source + `onSelect` + controlled `activeIndex` |
| `src/components/Layout/GooeyNav.css` | New — upstream CSS + white color token overrides |

---

## 5. Out of Scope

- AvatarMenu logic — no changes
- Search dropdown content/behavior — no changes
- Mobile/responsive layout — this is a desktop Electron app
- GooeyNav particle colors — all white (no colorful variant)
