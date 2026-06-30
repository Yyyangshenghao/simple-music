# TopBar Redesign — GooeyNav + Collapsible Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign TopBar to be taller (52px), give the back button more breathing room, collapse the search bar to an 88px stub that expands leftward on click, and replace plain tab buttons with GooeyNav (white glass style).

**Architecture:** Three sequential tasks — (1) create GooeyNav as a standalone component with controlled `activeIndex` and `onSelect` callback, (2) update TopBar CSS for sizing/spacing/search animation, (3) update TopBar JSX to wire GooeyNav and search collapse logic. GooeyNav receives controlled `activeIndex` derived from Zustand `currentView`, so all navigation paths (tab click, back button) keep it in sync.

**Tech Stack:** React 18, TypeScript, CSS Modules (TopBar), plain CSS (GooeyNav), Zustand, Electron desktop app with macOS traffic lights.

## Global Constraints

- GooeyNav particle colors: all white (`--color-1` through `--color-4` = `white`)
- TopBar height: 52px (was 44px)
- Back button: 34×34px, SVG icon 18×18, `margin-left: 8px`
- Left padding on `.bar`: `88px` (was 80px) to clear traffic lights
- Search collapsed width: 88px; expanded width: 260px
- Search expand transition: `width 0.35s var(--sm-ease-out)`, right-edge anchored (expands leftward)
- No changes to AvatarMenu, search dropdown content, or navigation store
- GooeyNav file: plain CSS (not CSS Module) imported directly in the TSX file

---

## File Map

| File | Action |
|------|--------|
| `src/components/Layout/GooeyNav.tsx` | Create — standalone component |
| `src/components/Layout/GooeyNav.css` | Create — plain CSS with white color tokens |
| `src/components/Layout/TopBar.module.css` | Modify — height, back button, search animation |
| `src/components/Layout/TopBar.tsx` | Modify — GooeyNav wiring, search collapse logic |

---

### Task 1: Create GooeyNav component

**Files:**
- Create: `src/components/Layout/GooeyNav.tsx`
- Create: `src/components/Layout/GooeyNav.css`

**Interfaces:**
- Produces: `GooeyNav` default export
  ```ts
  interface GooeyNavProps {
    items: { label: string; href: string }[]
    animationTime?: number
    particleCount?: number
    particleDistances?: [number, number]
    particleR?: number
    timeVariance?: number
    colors?: number[]
    initialActiveIndex?: number
    activeIndex?: number        // controlled — overrides internal state when provided
    onSelect?: (index: number) => void
  }
  ```

- [ ] **Step 1: Create GooeyNav.css**

Create `src/components/Layout/GooeyNav.css` with this exact content:

```css
:root {
  --linear-ease: linear(
    0, 0.068, 0.19 2.7%, 0.804 8.1%, 1.037,
    1.199 13.2%, 1.245, 1.27 15.8%, 1.274,
    1.272 17.4%, 1.249 19.1%, 0.996 28%,
    0.949, 0.928 33.3%, 0.926, 0.933 36.8%,
    1.001 45.6%, 1.013, 1.019 50.8%,
    1.018 54.4%, 1 63.1%, 0.995 68%,
    1.001 85%, 1
  );
}

.gooey-nav-container {
  position: relative;
  --color-1: white;
  --color-2: white;
  --color-3: white;
  --color-4: white;
}

.gooey-nav-container nav {
  display: flex;
  position: relative;
  transform: translate3d(0, 0, 0.01px);
}

.gooey-nav-container nav ul {
  display: flex;
  gap: 2em;
  list-style: none;
  padding: 0 1em;
  margin: 0;
  position: relative;
  z-index: 3;
  color: white;
  text-shadow: 0 1px 1px hsl(205deg 30% 10% / 0.2);
}

.gooey-nav-container nav ul li {
  border-radius: 100vw;
  position: relative;
  cursor: pointer;
  transition: background-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease;
  box-shadow: 0 0 0.5px 1.5px transparent;
  color: white;
}

.gooey-nav-container nav ul li a {
  display: inline-block;
  padding: 0.5em 1em;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  color: inherit;
}

.gooey-nav-container nav ul li:focus-within:has(:focus-visible) {
  box-shadow: 0 0 0.5px 1.5px white;
}

.gooey-nav-container nav ul li::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  background: white;
  opacity: 0;
  transform: scale(0);
  transition: all 0.3s ease;
  z-index: -1;
}

.gooey-nav-container nav ul li.active {
  color: black;
  text-shadow: none;
}

.gooey-nav-container nav ul li.active::after {
  opacity: 1;
  transform: scale(1);
}

.gooey-nav-container .effect {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  opacity: 1;
  pointer-events: none;
  display: grid;
  place-items: center;
  z-index: 1;
}

.gooey-nav-container .effect.text {
  color: white;
  transition: color 0.3s ease;
}

.gooey-nav-container .effect.text.active {
  color: black;
}

.gooey-nav-container .effect.filter {
  filter: blur(7px) contrast(100) blur(0);
  mix-blend-mode: lighten;
}

.gooey-nav-container .effect.filter::before {
  content: '';
  position: absolute;
  inset: -75px;
  z-index: -2;
  background: black;
}

.gooey-nav-container .effect.filter::after {
  content: '';
  position: absolute;
  inset: 0;
  background: white;
  transform: scale(0);
  opacity: 0;
  z-index: -1;
  border-radius: 100vw;
}

.gooey-nav-container .effect.active::after {
  animation: pill 0.3s ease both;
}

@keyframes pill {
  to { transform: scale(1); opacity: 1; }
}

.particle,
.point {
  display: block;
  opacity: 0;
  width: 20px;
  height: 20px;
  border-radius: 100%;
  transform-origin: center;
}

.particle {
  --time: 5s;
  position: absolute;
  top: calc(50% - 8px);
  left: calc(50% - 8px);
  animation: particle calc(var(--time)) ease 1 -350ms;
}

.point {
  background: var(--color);
  opacity: 1;
  animation: point calc(var(--time)) ease 1 -350ms;
}

@keyframes particle {
  0% {
    transform: rotate(0deg) translate(var(--start-x), var(--start-y));
    opacity: 1;
    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45);
  }
  70% {
    transform: rotate(calc(var(--rotate) * 0.5)) translate(calc(var(--end-x) * 1.2), calc(var(--end-y) * 1.2));
    opacity: 1;
    animation-timing-function: ease;
  }
  85% {
    transform: rotate(calc(var(--rotate) * 0.66)) translate(var(--end-x), var(--end-y));
    opacity: 1;
  }
  100% {
    transform: rotate(calc(var(--rotate) * 1.2)) translate(calc(var(--end-x) * 0.5), calc(var(--end-y) * 0.5));
    opacity: 1;
  }
}

@keyframes point {
  0% {
    transform: scale(0);
    opacity: 0;
    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45);
  }
  25% { transform: scale(calc(var(--scale) * 0.25)); }
  38% { opacity: 1; }
  65% {
    transform: scale(var(--scale));
    opacity: 1;
    animation-timing-function: ease;
  }
  85% { transform: scale(var(--scale)); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
}
```

- [ ] **Step 2: Create GooeyNav.tsx**

Create `src/components/Layout/GooeyNav.tsx` with this exact content:

```tsx
import { useRef, useEffect, useState } from 'react'
import './GooeyNav.css'

interface GooeyNavItem {
  label: string
  href: string
}

interface GooeyNavProps {
  items: GooeyNavItem[]
  animationTime?: number
  particleCount?: number
  particleDistances?: [number, number]
  particleR?: number
  timeVariance?: number
  colors?: number[]
  initialActiveIndex?: number
  activeIndex?: number
  onSelect?: (index: number) => void
}

const GooeyNav = ({
  items,
  animationTime = 600,
  particleCount = 15,
  particleDistances = [90, 10],
  particleR = 100,
  timeVariance = 300,
  colors = [1, 2, 3, 1, 2, 3, 1, 4],
  initialActiveIndex = 0,
  activeIndex: controlledIndex,
  onSelect,
}: GooeyNavProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLUListElement>(null)
  const filterRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [internalIndex, setInternalIndex] = useState(initialActiveIndex)

  const activeIndex = controlledIndex !== undefined ? controlledIndex : internalIndex

  const noise = (n = 1) => n / 2 - Math.random() * n

  const getXY = (distance: number, pointIndex: number, totalPoints: number): [number, number] => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180)
    return [distance * Math.cos(angle), distance * Math.sin(angle)]
  }

  const createParticle = (i: number, t: number, d: [number, number], r: number) => {
    const rotate = noise(r / 10)
    return {
      start: getXY(d[0], particleCount - i, particleCount),
      end: getXY(d[1] + noise(7), particleCount - i, particleCount),
      time: t,
      scale: 1 + noise(0.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
    }
  }

  const makeParticles = (element: HTMLSpanElement) => {
    const d = particleDistances
    const r = particleR
    const bubbleTime = animationTime * 2 + timeVariance
    element.style.setProperty('--time', `${bubbleTime}ms`)

    for (let i = 0; i < particleCount; i++) {
      const t = animationTime * 2 + noise(timeVariance * 2)
      const p = createParticle(i, t, d, r)
      element.classList.remove('active')

      setTimeout(() => {
        const particle = document.createElement('span')
        const point = document.createElement('span')
        particle.classList.add('particle')
        particle.style.setProperty('--start-x', `${p.start[0]}px`)
        particle.style.setProperty('--start-y', `${p.start[1]}px`)
        particle.style.setProperty('--end-x', `${p.end[0]}px`)
        particle.style.setProperty('--end-y', `${p.end[1]}px`)
        particle.style.setProperty('--time', `${p.time}ms`)
        particle.style.setProperty('--scale', `${p.scale}`)
        particle.style.setProperty('--color', `var(--color-${p.color}, white)`)
        particle.style.setProperty('--rotate', `${p.rotate}deg`)
        point.classList.add('point')
        particle.appendChild(point)
        element.appendChild(particle)
        requestAnimationFrame(() => element.classList.add('active'))
        setTimeout(() => {
          try { element.removeChild(particle) } catch { /* already removed */ }
        }, t)
      }, 30)
    }
  }

  const updateEffectPosition = (element: HTMLElement) => {
    if (!containerRef.current || !filterRef.current || !textRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const pos = element.getBoundingClientRect()
    const styles = {
      left: `${pos.x - containerRect.x}px`,
      top: `${pos.y - containerRect.y}px`,
      width: `${pos.width}px`,
      height: `${pos.height}px`,
    }
    Object.assign(filterRef.current.style, styles)
    Object.assign(textRef.current.style, styles)
    textRef.current.innerText = element.innerText
  }

  const triggerTransition = (el: HTMLElement, index: number) => {
    if (activeIndex === index) return
    setInternalIndex(index)
    onSelect?.(index)
    updateEffectPosition(el)
    if (filterRef.current) {
      filterRef.current.querySelectorAll('.particle').forEach((p) =>
        filterRef.current!.removeChild(p)
      )
    }
    if (textRef.current) {
      textRef.current.classList.remove('active')
      void textRef.current.offsetWidth
      textRef.current.classList.add('active')
    }
    if (filterRef.current) makeParticles(filterRef.current)
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, index: number) => {
    e.preventDefault()
    triggerTransition(e.currentTarget, index)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      triggerTransition(e.currentTarget.parentElement as HTMLLIElement, index)
    }
  }

  useEffect(() => {
    if (!navRef.current || !containerRef.current) return
    const activeLi = navRef.current.querySelectorAll('li')[activeIndex] as HTMLElement | undefined
    if (activeLi) {
      updateEffectPosition(activeLi)
      textRef.current?.classList.add('active')
    }
    const resizeObserver = new ResizeObserver(() => {
      const li = navRef.current?.querySelectorAll('li')[activeIndex] as HTMLElement | undefined
      if (li) updateEffectPosition(li)
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [activeIndex])

  return (
    <div className="gooey-nav-container" ref={containerRef}>
      <nav>
        <ul ref={navRef}>
          {items.map((item, index) => (
            <li key={index} className={activeIndex === index ? 'active' : ''}>
              <a
                href={item.href}
                onClick={(e) => handleClick(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <span className="effect filter" ref={filterRef} />
      <span className="effect text" ref={textRef} />
    </div>
  )
}

export default GooeyNav
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "GooeyNav|error" | head -20
```

Expected: no errors in GooeyNav.tsx or GooeyNav.css import.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/GooeyNav.tsx src/components/Layout/GooeyNav.css
git commit -m "feat: add GooeyNav component with white glass color tokens and controlled activeIndex"
```

---

### Task 2: Update TopBar CSS

**Files:**
- Modify: `src/components/Layout/TopBar.module.css`

**Interfaces:**
- Produces: `.searchExpanded` class (width 260px); `.searchPlaceholder` class; updated `.bar`, `.backBtn`

- [ ] **Step 1: Update `.bar` height and left padding**

In `TopBar.module.css`, find and change these two values inside `.bar`:

```css
/* Before */
height: 44px;
padding: 0 12px 0 80px;

/* After */
height: 52px;
padding: 0 12px 0 88px;
```

- [ ] **Step 2: Update `.backBtn` size and margin**

In `.backBtn`, change:
```css
/* Before */
width: 28px;
height: 28px;
```
to:
```css
/* After */
width: 34px;
height: 34px;
margin-left: 8px;
```

- [ ] **Step 3: Replace search form rules**

Remove the current `.searchForm` block and `.searchForm:focus-within` block, replace with:

```css
.searchForm {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--glass-bg-base);
  border: 1px solid var(--sm-border);
  border-radius: 8px;
  padding: 5px 10px;
  width: 88px;
  overflow: hidden;
  cursor: pointer;
  transition: width 0.35s var(--sm-ease-out), border-color 0.15s;
}

.searchExpanded {
  width: 260px;
  cursor: text;
  border-color: var(--glass-border-card);
}
```

(Delete `.searchForm:focus-within` entirely — expansion is now controlled by the `.searchExpanded` class.)

- [ ] **Step 4: Add `.searchPlaceholder` rule**

Add after `.searchInput::placeholder`:

```css
.searchPlaceholder {
  font-size: 13px;
  color: var(--sm-text-secondary);
  white-space: nowrap;
  user-select: none;
}
```

- [ ] **Step 5: Remove `.tab`, `.tab:hover`, `.tabActive`, `.tabActive::after` rules**

Delete these four rule blocks entirely — GooeyNav replaces them.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout/TopBar.module.css
git commit -m "feat: update TopBar CSS — 52px height, larger back button, collapsible search"
```

---

### Task 3: Update TopBar component

**Files:**
- Modify: `src/components/Layout/TopBar.tsx`

**Interfaces:**
- Consumes: `GooeyNav` default export from `./GooeyNav`
- Consumes: `styles.searchExpanded`, `styles.searchPlaceholder` from Task 2

- [ ] **Step 1: Update imports and remove NAV_TABS**

At the top of `TopBar.tsx`:

1. Change the React import line to include `useEffect`:
   ```tsx
   import { useState, useRef, useEffect } from 'react'
   ```
   (Remove `type { FormEvent }` — no longer needed.)

2. Add GooeyNav import after existing imports:
   ```tsx
   import GooeyNav from './GooeyNav'
   ```

3. Delete the `NAV_TABS` constant (lines 11–14 in the current file):
   ```tsx
   // DELETE:
   const NAV_TABS: { view: AppView; label: string }[] = [
     { view: 'explore', label: '探索' },
     { view: 'library', label: '我的库' },
   ]
   ```

- [ ] **Step 2: Add `isExpanded` state inside `TopBar`**

Inside the `TopBar` function body, alongside existing state declarations, add:
```tsx
const [isExpanded, setIsExpanded] = useState(false)
```

- [ ] **Step 3: Add `useEffect` to auto-focus on expand**

After the state declarations, add:
```tsx
useEffect(() => {
  if (isExpanded) inputRef.current?.focus()
}, [isExpanded])
```

- [ ] **Step 4: Add search expand/collapse handlers**

Replace `handleSubmit` (no longer needed) with two new handlers:
```tsx
function handleSearchClick() {
  if (!isExpanded) setIsExpanded(true)
}

function handleSearchBlur() {
  setTimeout(() => {
    setSearchFocused(false)
    if (!keyword) setIsExpanded(false)
  }, 150)
}
```

Delete `handleSubmit` entirely.

- [ ] **Step 5: Update `showDropdown` condition**

Change:
```tsx
const showDropdown = searchFocused && (keyword.length > 0 || loading || hasResults)
```
to:
```tsx
const showDropdown = isExpanded && searchFocused && (keyword.length > 0 || loading || hasResults)
```

- [ ] **Step 6: Update back button SVG size**

In the back button JSX, change:
```tsx
<svg width="16" height="16" ...>
```
to:
```tsx
<svg width="18" height="18" ...>
```

- [ ] **Step 7: Replace center tabs with GooeyNav**

Replace the entire `<div className={styles.center}>` block:

```tsx
{/* Before — DELETE: */}
<div className={styles.center}>
  {NAV_TABS.map((tab) => (
    <button
      key={tab.view as string}
      className={`${styles.tab} ${currentView === tab.view ? styles.tabActive : ''}`}
      onClick={() => navigateTo(tab.view)}
    >
      {tab.label}
    </button>
  ))}
</div>

{/* After — ADD: */}
<div className={styles.center}>
  <GooeyNav
    items={[
      { label: '探索', href: '#' },
      { label: '我的库', href: '#' },
    ]}
    activeIndex={currentView === 'library' ? 1 : 0}
    onSelect={(i) => navigateTo(i === 0 ? 'explore' : 'library')}
    particleCount={12}
    colors={[1, 1, 2, 1, 2, 1]}
  />
</div>
```

- [ ] **Step 8: Replace search form JSX**

Replace the `<div className={styles.searchWrap}>` inner content. The new version replaces `<form>` with a `<div>`, toggles between stub and input, and handles Enter via `onKeyDown`:

```tsx
<div className={styles.searchWrap}>
  <div
    className={`${styles.searchForm} ${isExpanded ? styles.searchExpanded : ''}`}
    onClick={handleSearchClick}
  >
    <svg
      className={styles.searchIcon}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
    {isExpanded ? (
      <input
        ref={inputRef}
        className={styles.searchInput}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={() => setSearchFocused(true)}
        onBlur={handleSearchBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void runSearch() }
        }}
        placeholder="搜索歌曲、歌手…"
      />
    ) : (
      <span className={styles.searchPlaceholder}>搜索…</span>
    )}
  </div>

  {showDropdown && (
    <div className={styles.searchDropdown}>
      {loading && <p className={styles.searchHint}>搜索中…</p>}
      {!loading && keyword.length > 0 && !hasResults && (
        <p className={styles.searchHint}>无结果</p>
      )}
      {!loading && artists.length > 0 && (
        <div>
          <div className={styles.searchSection}>歌手</div>
          {artists.map((a, i) => (
            <button key={`a-${i}`} className={styles.artistRow} onMouseDown={() => pickArtist(a)}>
              {a.avatar && <img className={styles.rowAvatar} src={a.avatar} alt="" loading="lazy" />}
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}
      {!loading && songs.length > 0 && (
        <div>
          {artists.length > 0 && <div className={styles.searchSection}>歌曲</div>}
          {songs.slice(0, 8).map((s, i) => (
            <button key={`s-${i}`} className={styles.songRow} onMouseDown={() => pickSong(i)}>
              {s.cover && <img className={styles.rowCover} src={s.cover} alt="" loading="lazy" />}
              <div className={styles.songInfo}>
                <span className={styles.songName}>{s.name}</span>
                <span className={styles.songArtist}>{s.artist}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 9: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 10: Visual verification**

Start the app and confirm all of the following:

1. TopBar is visibly taller than before
2. Back button is larger and has clear gap from macOS traffic lights
3. Search shows as a short stub (icon + "搜索…") — approximately 88px wide
4. Clicking search expands it smoothly leftward to ~260px
5. Typing a keyword keeps the search expanded
6. Blurring the input with empty keyword collapses it back to the stub
7. GooeyNav renders "探索" and "我的库" in white text
8. Clicking "我的库" plays the white bubble particle animation and navigates to the library view
9. Clicking "探索" plays the particle animation and navigates back
10. Using the back button to navigate updates the GooeyNav active tab correctly

- [ ] **Step 11: Commit**

```bash
git add src/components/Layout/TopBar.tsx
git commit -m "feat: wire GooeyNav and collapsible search into TopBar"
```
