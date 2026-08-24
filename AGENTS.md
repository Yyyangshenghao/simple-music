# Repository Guidelines

## Project Structure & Module Organization

Simple Music is an Electron, React, and TypeScript desktop player. Keep changes in the owning layer:

- `electron/`: main process, IPC handlers, preload bridges, windows, and platform adapters.
- `server/`: embedded HTTP API; routes live in `server/routes/` and supporting logic in `server/lib/`.
- `src/`: React renderer, organized into `pages/`, `components/`, Zustand `stores/`, reusable `hooks/`, and pure `lib/` logic.
- `overlays/`: independent renderer entries for desktop lyrics, wallpaper, and the mini player.
- `public/` and `build/`: runtime assets and packaging resources. Project documentation belongs in `docs/`.

Tests are colocated with source as `*.test.ts`; there is no separate test directory.

## Build, Test, and Development Commands

- `npm install`: install locked dependencies.
- `npm run dev`: start Electron; the embedded API starts with the app.
- `npm run server:dev`: run only the API server on port `35530` for endpoint work.
- `npm run typecheck`: check both Node/Electron and renderer TypeScript projects.
- `npm test`: run the full Vitest suite once.
- `npx vitest run src/lib/stack-pool.test.ts`: run one test file.
- `npm run build`: bundle into `out/`; use `build:mac` or `build:win` for installers.

## Coding Style & Naming Conventions

Follow existing TypeScript: two-space indentation, single quotes, no semicolons, strict typing, and ESM imports. Use `PascalCase` for components, `useCamelCase` for hooks, and kebab-case for utility modules. Keep `*.module.css` beside components; reuse `src/styles/tokens.css` variables and `src/lib/motion-presets.ts`. There is no lint command, so avoid unrelated formatting.

Treat `Track.duration` as milliseconds. Convert unknown IDs with `String()`. Resolve cross-source data through `serviceFor(data.source)`, and guard async state updates against stale responses.

## Testing Guidelines

Add colocated Vitest tests for logic changes. For bug fixes, first capture the regression in a failing test. There is no numeric coverage threshold; the baseline is `npm run typecheck && npm test`. Smoke-test affected UI flows with `npm run dev`.

## Commit & Pull Request Guidelines

Use focused branches such as `feat/desktop-lyrics-font` or `fix/qq-search-empty`. Commits use an English Conventional Commit type and concise Chinese subject, for example `fix: 修复切歌时封面竞态`. Keep each commit focused.

Pull requests must explain what changed, why, and how it was verified; link relevant issues and attach screenshots or recordings for UI changes. Obtain one approval, use squash merge, and delete the merged branch.

## Version Upgrade and Push Semantics

In this repository, a user request to “推送”, “提交并推送”, or “可以发了” means a complete version upgrade by default, not a branch-only `git push`. Follow `docs/build-and-release.md` section 0 end to end: choose the target version, update `package.json` and the root version in `package-lock.json`, create `docs/release-notes-X.Y.Z.md`, run the required checks, create a dedicated `chore(release): 发布 vX.Y.Z` commit, create an annotated `vX.Y.Z` tag, push the branch and tag, then wait for the Release workflow and verify its assets.

Resolve the target version from an explicit user version first, then a branch name such as `dev/2.0.2`, otherwise default to the next patch version. Stop on version or tag conflicts. Do not move or overwrite a pushed tag. A branch-only push is allowed only when the user explicitly says “只推代码”, “只推分支”, “不要升级版本”, or “不要打 tag”.

Before mutating release metadata, tell the user the resolved target version and that the operation will create a public tag and GitHub Release. Treat the original push request as authorization for the documented release flow, but do not include unrelated dirty files. Stop if the worktree contains ambiguous user changes.
