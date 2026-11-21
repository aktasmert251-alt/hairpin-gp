# APEX GP: Team rules (binding for every agent)

- **Project root:** `<repo>`
- **Approved plan:** `docs/sprints/PLAN.md` (Turkish). It wins every conflict.
- **Technical report:** `docs/design/planner-report.md` (architecture §3, contracts §4, physics §5, AI §6, track §7).
- **Visual direction:** `docs/design/DESIGN.md` (exists after Sprint 0).
- **Machine:** Windows 11, PowerShell 5.1, Node 24, RTX 4060 Laptop, 1080p.

## 1. Ownership (write only inside your area)

| Role | May write |
|---|---|
| Orchestrator | `.claude/agents/`, `docs/sprints/PLAN.md`, `docs/sprints/TEAM-RULES.md`, `docs/design/skills/`, `docs/design/planner-report.md`, git |
| Planner (Planlayıcı) | `docs/**` except the orchestrator files above and `docs/design/{DESIGN,design-contract,implementation-handoff}.md` / `docs/design/example.html` |
| Lead (Yönetici) | `src/{main.ts,contracts,core,game,race,data,sandbox}/**`, `scripts/shot.mjs`, root configs (`package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`) |
| Environment (Çevre) | `src/track/**`, `scripts/fetch-track.mjs`, `public/assets/env/**` |
| Graphics (Grafik) | `src/graphics/**`, `src/ui/**`, `src/trailer/**`, `docs/design/{DESIGN,design-contract,implementation-handoff}.md`, `docs/design/example.html`, `scripts/render-trailer.mjs`, `scripts/trailer-audio.mjs`, `public/assets/gra/**`, `media/**` |
| Driving engine (Sürüş) | `src/physics/**`, `src/ai/**`, `src/audio/**`, `public/assets/sur/**` |
| QC (Kalite) | `docs/qa/qc-*.md` only. Never edits `src`. |
| Tester (Testçi) | `tests/**`, `vitest.config.ts` and `playwright.config.ts` (from Sprint 1), `scripts/perf.mjs`, `docs/qa/test-*.md` |

Further rules:
- `src/contracts/**` is changed **only by the Lead**. Everyone else puts change requests in their final report.
- In Sprint 0 the Lead creates minimal stubs (`index.ts` + `stub/`) inside other roles' module folders so the walking skeleton runs. From Sprint 1 those folders belong to their owners, who replace the stubs.

## 2. Packages and git
- Do not run `npm install` or `npm i`. Put dependency requests in your report.
  - Exception: the Lead in Sprint 0.
- Do not run git commands. The orchestrator commits at sprint ends.

## 3. Ports and processes

| Role | Dev server port |
|---|---|
| Lead | 5173 |
| Environment | 5174 |
| Graphics-3D | 5175 |
| Driving | 5176 |
| Tester | 5177 |
| QC | 5178 |
| Graphics-UI | 5179 |

- Start your server with `npm run dev -- --port <port> --strictPort` as a background process, and remember its PID.
- Stop **only** the processes you started (`Stop-Process -Id <pid>`). Never kill all `node`/`chrome` processes; other agents are running.

## 4. See your own work
- Every module ships sandbox scenes (`src/<module>/sandbox/*.scene.ts`, opened with `?scene=<id>`).
- Take a screenshot with `node scripts/shot.mjs --port <port> --url "/?scene=<id>" --out test-results/screens/<role>/<name>.png` and **look at it with Read**.
- Iterate until it looks right. Do not claim visual quality you have not looked at.

## 5. Tests
- **Module unit tests** live in `src/<module>/__tests__/*.test.ts` and are written by the module owner.
- **Cross-module, sim, E2E and perf tests** live in `tests/**` and are written by the Tester.
- Run `npm run typecheck`, `npm test` and `npm run build`. Fix errors **in your own folders only**; report errors you find elsewhere.

## 6. Final report: ONE message, at most 8 KB
Use these headings: `## Status` (done / partial / blocked) · `## Done` · `## Files` · `## Commands and results` · `## Screenshots` (paths) · `## Contract change requests` · `## Known issues / next steps`.
Put anything longer into a file under your own area (or `docs/qa/` for QC and Tester) and link it.

## 7. Code rules
- TypeScript strict. Identifiers and comments in English. UI strings only through i18n (TR default, EN).
- **Sim layer** (`physics`, `ai`, `race`, `game/sim`, `track/{data,build,query,authoring}`, `core/{math,rng}`):
  - No `three`, no DOM, no `Math.random` (use the seeded RNG in state).
  - All state is plain data in `SimState`.
- **Hot loops** (per tick / per frame): no allocations. Reuse scratch objects.
- **`dispose()`:** every presentation module releases its geometries, materials, textures, render targets, DOM nodes, listeners, bus subscriptions and GSAP tweens.
- **Keyboard:**
  - Use `KeyboardEvent.code`.
  - Never bind Ctrl, Alt or Meta combinations. Ctrl+W closes the tab and cannot be blocked.
  - Call `preventDefault` on game keys.
- **Performance budgets** are in PLAN.md Ek B and planner-report §7.14.

## 8. Skills
- When your prompt names skills, load them with the Skill tool and follow them.
- If a skill cannot be loaded, say so in the report. The orchestrator will distil it into `docs/design/skills/<skill>.md` for you.

## 9. IP and assets
- Never use the words "F1" or "Formula 1", real team names, real driver names, or real logos.
- Use only procedural assets, CC0 assets (Poly Haven, ambientCG) and OFL fonts.
- Record every downloaded asset in `public/assets/<role>/CREDITS.part.md`: source URL, license, author.

## 10. PowerShell 5.1 notes
- There is no `&&`. Use `;` or `if ($?) { ... }`.
- When writing files from PowerShell, use UTF-8 without a BOM: `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- Prefer the Write and Edit tools for source files.

## 11. Coding discipline (Karpathy guidelines)
1. **Think before coding.** State your assumptions. If there are several readings of a task, name them. If something is unclear, stop and say so in your report; do not guess silently.
2. **Simplicity first.** Write the minimum code that meets the task's acceptance criteria. No speculative features, no single-use abstractions, no configurability nobody asked for, no handling for impossible cases. If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Touch only what the task needs. Do not reformat, refactor or "improve" adjacent code. Remove only the orphans your own change created. Delete scratch/debug files (`zz-*`, `*.scratch.*`) before you report.
4. **Goal-driven.** Turn each task into a verifiable check (a test or a screenshot plus a number), then loop until it passes. Bug fix = a failing test first, then the fix.

## 12. Skills every agent uses
- **karpathy-guidelines:** load it at the start of every session. §11 above is its short form.
- **graphify:** find code with the knowledge graph instead of reading many files: `"<python>" -m graphify query "<question>" --budget 1500`. You can also `explain "<Symbol>"` or `path "A" "B"`. The graph is a snapshot taken 2026-10-09; confirm critical details in the file itself.
- **Role skills (PLAN skill table):**
  - Grafik-UI: frontend-design, emil-design-eng, emilkowalski-motion, gsap-core, gsap-timeline, gsap-plugins and gsap-performance, then frame-logo-outro for the logo intro and impeccable-design-polish in Sprint 4.
  - QC: web-design-guidelines.
  - Sprint 5b trailer: motion-design.

## 13. Multiplayer additions (D-043)
- New role **Sunucu (SRV)**: owns `server/**` (Node server, room/lobby, validation, server-side AI sim, deploy scripts under `server/deploy/`). Port for local runs: **8787** (HTTP + WSS dev), test clients on their usual ports.
- The server may import the pure sim layer (`src/contracts`, `src/game/createSim` sim parts, `src/race`, `src/physics`, `src/ai`, `src/track/{data,build,query,authoring,registry}`, `src/core/{math,rng}`) read-only; it never imports `three`, DOM or `src/ui|graphics|audio`.
- Client networking lives in `src/net/**` (owned by the Lead).
