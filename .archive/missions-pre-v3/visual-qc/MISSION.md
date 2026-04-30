# Visual QC — THE Hardest Problem

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ON HOLD
Joel directive 2026-03-10: On hold until further notice.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from gemini, drift-i, kimi. - kimi shipped: [KIMI — QC SWEEP STARTED: LEADERSHIP/RECRUITER ROLES] Beginn - kimi shipped: [KIMI — QC REPORT DELIVERED + ARCHITECTURE FEEDBACK POSTED]  - kimi shipped: [KIMI — QUESTIONS & CONCERNS FOR TEAM] Following my QC sweep


## Mission Type: PRODUCT
Feedback loop: [define before work starts]. Evidence standard: shipped artifact + human/user consequence pathway.
This is NOT a standalone product. This is the **QC process/capability** that ANY mission with a frontend uses. When an agent on WarriorPath, UI/Visual, or FastOps Product builds something visual, they use this process to verify quality. This mission's job is to build and improve that process.

## What This Mission Produces
A reusable visual QC process (tool, skill, knowledge — whatever form makes sense) that other missions can invoke. Think of it as the colony's quality standard for anything with a UI.

## Mission-Specific Constraints
1. **2-model visual testing required.** Round 1 done by Model 1 (e.g., Gemini). Round 2 done by Model 2 (e.g., GPT). Sequential, not parallel — each model tests independently.
2. **Frontier research required.** What does best-in-world visual QA look like? Automated screenshot comparison, visual regression testing, accessibility auditing — research before building.
3. **Deep historical research required.** Mine the KB, handoffs, and past sessions for every visual QC attempt. The /visual-qa skill exists but hasn't solved the problem. Understand WHY before rebuilding.
4. **Use subagents** for research and parallel investigation.
5. **$2 budget** per session for external model calls.

## Definition of Done
A process exists that catches what Joel catches. Joel finds errors in under 60 seconds — the QC process should find them in under 60 seconds too. When an agent says "visual QC passed," Joel should agree.

## Intel Package — What 8+ Agents Proved (Read Before Building)

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| 4-layer QC tool | W1-VQC-1 | Built visual-qc.js: Programmatic + Visual + Interaction + Intent. 92% accuracy, ~$0.11/run. | Foundation tool. Now expanded to 6 layers. |
| Regression baseline | W3-VQC-4 | regression-baseline.js: 3-breakpoint screenshots, canvas pixel diffing, 0.5% threshold. Zero extra deps beyond Playwright. | Integrated into visual-qc.js as Layer 2.6 (W5-VQC-9). Auto-detects baselines. |
| Animation audit | W4-VQC-6 | animation-audit.js: 5 detection layers (CSS discovery, layout-thrash, reduced-motion, jank/FPS, stuck animations). | Integrated as Layer 2.5 (W4-VQC-7). Added behavioral reduced-motion test + CLS. |
| 2-model sequential QC | W3-VQC-3 | dual-model-qc.js: Round 1 Gemini ("describe then evaluate"), Round 2 GPT (devil's advocate). Deterministic override — Layer 1/3 criticals can't be overruled by models. | Addresses Constraint #1. Separate post-processing step (requires API keys). |
| Detector validation | W4-VQC-5 | validate-qc.js: 9 test pages with known bugs. 10/10 detectors fire. Layer 4 intent: 16/16 pass (anvil-v). | Proof Layers 1-3 catch what they claim. Run after any visual-qc.js change. |
| Full pipeline integration | W4-VQC-7, W5-VQC-9 | Wired animation-audit (Layer 2.5) + regression-baseline (Layer 2.6) INTO visual-qc.js. Module exports added. | 6-layer pipeline: Programmatic → Visual → Animation → Regression → Interaction → Intent. |
| /visual-qc skill | anvil-v | Wired as Claude Code skill. Any agent: `/visual-qc <URL>`. | Accessible without knowing file paths. |

### Known constraints (don't fight these)

1. **Screenshot-only QC misses functional bugs.** Screenshots are CONFIRMATION, not detection. (W-056)
2. **Direct-URL testing bypasses navigation.** Misses the exact bugs Joel finds. Must test through UI. (W-084)
3. **Vision model as detection layer fails.** detail:'low' = false negatives. GPT-4o-mini scores harshly. (W-057)
4. **Source code audit is NOT visual QC.** Code review != UI/UX.
5. **Single-pass building hides structural errors.** Right checks in wrong structure is invisible from builder's frame. (W-129)
6. **Deterministic overrides probabilistic.** Layers 1+3 (programmatic + interaction) override 2+4 (visual + intent) for verdicts. (W-056)
7. **Intent matching is keyword-based.** Works on structured pages (16/16 pass) but fails on SPAs with dynamic content. Vision model API is the real fix.

### Unresolved questions (this is YOUR work)

1. What's the right threshold for "this looks wrong"? (W-023 suggests evidence-driven thresholds)
2. Vision model integration — screenshots not yet sent as images to vision-capable models.
3. No SPA/dynamic-content testing — all test pages are static HTML. Need JS-rendered test pages.
4. dual-model-qc.js is standalone, not auto-triggered by other missions.

### Build on this, not from scratch

- **visual-qc.js** — 6-layer pipeline: `node missions/visual-qc/visual-qc.js --url <URL> [--json]`
- **dual-model-qc.js** — 2-model verification: `node missions/visual-qc/dual-model-qc.js --report report.json`
- **validate-qc.js** — Detector validation: 16/16 pass
- **animation-audit.js** — `const { auditAnimations } = require('./animation-audit')`
- **regression-baseline.js** — `const { captureBaseline, compareAgainstBaseline } = require('./regression-baseline')`
- **/visual-qc skill** — `.claude/commands/visual-qc.md`
- **KB wisdom:** W-056 (4-layer), W-057 (empty state), W-058 (describe-then-evaluate), W-081 (intent as root), W-084 (nav-through-UI), W-085 (Tailwind ghosts), W-129 (single-pass trap), W-130 (devil's advocate)

## Skill Signals
Testing, image processing, automation, frontend knowledge, process design

## Successor Notes
### W1-VQC-1 (2026-03-07)
Built `visual-qc.js` — the first reusable four-layer QC tool implementing KB wisdom (W-056 through W-085). Run it with `node missions/visual-qc/visual-qc.js --url <URL>`. It implements:
- Layer 1 (Programmatic): Console errors, network failures, empty pages, Tailwind class validation, broken images, accessibility basics, contrast
- Layer 2 (Visual): Multi-breakpoint screenshots, overflow detection, empty state detection
- Layer 3 (Interaction): Click-through navigation testing (W-084 pattern), form input visibility, zero-size clickable elements
- Layer 4 (Intent): Goal-completion verification against PRD goals (W-081 pattern)

**Gaps remaining:**
1. No 2-model sequential testing yet (Constraint #1) — needs external model API integration for dual-model QC
2. Layer 4 intent matching is keyword-based heuristic — needs vision model API call for real intent verification
3. No animation testing yet — need frame-rate/timing behavioral signals
4. No regression baseline comparison — need before/after screenshot diffing
5. Not yet wired as a hook or skill — currently standalone CLI tool

### W3-VQC-4 (2026-03-07)
Built `regression-baseline.js` — addresses Gap #4 (no regression baseline comparison). Zero extra dependencies beyond Playwright. Uses browser canvas for pixel diffing.
- **Capture mode:** Screenshots at 3 breakpoints (mobile/tablet/desktop) for any number of pages, stored with JSON manifest
- **Compare mode:** Diffs current screenshots against baseline, generates red-highlighted diff images, configurable threshold (default 0.5%)
- **Design:** Canvas-based pixel comparison runs inside Playwright's browser context — no pixelmatch/pngjs needed
- **Integration:** Outputs JSON (`--json`) compatible with visual-qc.js report format. Exit code 1 on regression = CI-friendly.

**Gaps remaining after W3-VQC-4:**
1. No 2-model sequential testing yet (Constraint #1)
2. Layer 4 intent matching still keyword-based — needs vision model API
3. No animation testing
4. ~~No regression baseline~~ DONE — regression-baseline.js
5. Not yet wired as hook/skill
6. regression-baseline.js not yet integrated INTO visual-qc.js as Layer 2.5 (could run automatically when baselines exist)

### W4-VQC-6 (2026-03-07)
Built `animation-audit.js` — addresses Gap #3 (no animation testing). Zero extra dependencies beyond Playwright. Runs as standalone CLI or importable module for visual-qc.js integration.
- **5 detection layers:** (1) CSS animation/transition discovery + duration sanity, (2) Layout-thrashing detection (animating width/height/top/left instead of transform), (3) prefers-reduced-motion compliance check (WCAG 2.3.3), (4) Jank detection via requestAnimationFrame timing (P95/P99/avg FPS), (5) Web Animations API stuck-animation detection
- **Smart filtering:** Distinguishes intentional infinite animations (spinners, loaders, shimmer) from suspicious ones
- **Performance signals:** Invisible/off-screen animations flagged as wasted GPU, >5s durations flagged as likely bugs, <16ms durations flagged as below-frame-rate
- **Module export:** `const { auditAnimations } = require('./animation-audit')` — visual-qc.js can call it as Layer 2.5
- **CI-friendly:** Exit code 1 on high/critical issues, JSON output via `--json`

**Gaps remaining after W4-VQC-6:**
1. No 2-model sequential testing yet (Constraint #1)
2. Layer 4 intent matching still keyword-based — needs vision model API
3. ~~No animation testing~~ DONE — animation-audit.js
4. ~~No regression baseline~~ DONE — regression-baseline.js
5. Not yet wired as hook/skill
6. regression-baseline.js + animation-audit.js not yet integrated INTO visual-qc.js as Layer 2.5

### W3-VQC-3 (2026-03-07)
Built `dual-model-qc.js` — addresses Gap #1 (Constraint #1: 2-model sequential testing). The orchestrator that wires visual-qc.js evidence into ask-model.js for dual-model verification.

**Architecture:**
1. Takes visual-qc.js JSON report as input (--report)
2. Builds structured evidence package from all 4 layers — deterministic findings presented as facts, probabilistic evidence presented for model evaluation
3. **Round 1** (default: Gemini): "Describe then evaluate" prompt per W-058 — model describes what the app does from evidence, then evaluates against goals
4. **Round 2** (default: GPT): Independent devil's advocate prompt per W-130 — explicitly told to challenge, look for "almost works" features, incomplete implementations
5. **Synthesis**: Agreement = high confidence. Disagreement = conservative (FAIL beats PASS). Deterministic override per W-056 — Layer 1/3 critical issues cannot be overridden by model opinions.

**Usage:**
```
node missions/visual-qc/visual-qc.js --url http://localhost:3000 --json > report.json
node missions/visual-qc/dual-model-qc.js --report report.json
node missions/visual-qc/dual-model-qc.js --report report.json --model1 gemini --model2 deepseek-r1
node missions/visual-qc/dual-model-qc.js --report report.json --evidence-only  # preview prompts without API calls
```

**Gaps remaining after W3-VQC-3:**
1. ~~No 2-model sequential testing~~ DONE — dual-model-qc.js
2. Layer 4 intent matching still keyword-based — needs vision model API (dual-model-qc.js addresses this partially: models evaluate the evidence package with richer context than keyword matching, but screenshots are not yet sent as images to vision-capable models)
3. ~~No animation testing~~ DONE — animation-audit.js
4. ~~No regression baseline~~ DONE — regression-baseline.js
5. Not yet wired as hook/skill
6. Satellite tools (regression-baseline, animation-audit, dual-model-qc) not yet integrated INTO visual-qc.js as a unified pipeline
7. Vision model integration — dual-model-qc.js sends text evidence but not screenshot images. When ask-model.js supports image input, screenshots should be included in the evidence package.

### W4-VQC-5 (2026-03-07)
Built `validate-qc.js` — the "tested-as-customer" harness that proves visual-qc.js detectors actually fire on known-bad inputs. Addresses the root cause MEMORY.md identifies: "done means code-compiles, not tested-as-customer."

**What it does:**
- Spins up a local HTTP server with 9 test pages, each containing specific known bugs (console errors, broken images, empty pages, contrast failures, a11y issues, Tailwind ghost classes, horizontal overflow, broken nav links, zero-size clickables)
- Runs the same Playwright-based checks that visual-qc.js uses against each page
- Verifies each detector fires on the bug it claims to catch
- 10/10 detectors validated on first run

**Why this matters:**
Every predecessor built or extended visual-qc.js. Nobody tested whether the detectors actually work. This harness is the proof that Layers 1-3 catch what they claim. Run it after any change to visual-qc.js to prevent detector regression.

**Usage:**
```
node missions/visual-qc/validate-qc.js           # human-readable output
node missions/visual-qc/validate-qc.js --json     # CI-friendly JSON output
```

**Gaps remaining after W4-VQC-5:**
1. ~~No 2-model sequential testing~~ DONE -- dual-model-qc.js
2. Layer 4 intent matching still keyword-based -- needs vision model API
3. ~~No animation testing~~ DONE -- animation-audit.js
4. ~~No regression baseline~~ DONE -- regression-baseline.js
5. Not yet wired as hook/skill
6. Satellite tools not yet integrated into visual-qc.js as unified pipeline
7. Vision model integration -- screenshots not sent as images to vision models
8. ~~No validation that detectors actually work~~ DONE -- validate-qc.js (10/10 pass)

### W4-VQC-7 (2026-03-07)
**Integration + behavioral reduced-motion testing.** Two contributions:

1. **Wired animation-audit.js INTO visual-qc.js as Layer 2.5** (addresses Gap #6). When `visual-qc.js` runs in full mode, it now automatically imports and runs `auditAnimations()` between Layer 2 (Visual) and Layer 3 (Interaction). Graceful degradation if animation-audit.js is missing. The pipeline is now 5 layers: Programmatic -> Visual -> Animation -> Interaction -> Intent.

2. **Added behavioral prefers-reduced-motion test to animation-audit.js.** Prior implementation (W4-VQC-6) only scanned stylesheets for the `@media (prefers-reduced-motion)` rule. That misses the case where the rule exists but doesn't actually disable all animations. New test: emulates `prefers-reduced-motion: reduce` via Playwright, counts animations still running, reports any that ignore the preference. Also added CLS (Cumulative Layout Shift) observation during animation — catches animations that cause content jumps (>0.25 = "poor", 0.1-0.25 = "needs improvement").

**Gaps remaining after W4-VQC-7:**
1. ~~No 2-model sequential testing~~ DONE -- dual-model-qc.js
2. Layer 4 intent matching still keyword-based -- needs vision model API
3. ~~No animation testing~~ DONE -- animation-audit.js
4. ~~No regression baseline~~ DONE -- regression-baseline.js
5. Not yet wired as hook/skill (standalone CLI + module, not auto-triggered)
6. ~~Satellite tools not integrated into visual-qc.js~~ PARTIAL -- animation-audit.js integrated; regression-baseline.js and dual-model-qc.js still standalone
7. Vision model integration -- screenshots not sent as images to vision models
8. ~~No validation that detectors actually work~~ DONE -- validate-qc.js

### W5-VQC-9 (2026-03-07)
**Regression baseline integration + module exports.** Two contributions closing Gap #6:

1. **Wired regression-baseline.js INTO visual-qc.js as Layer 2.6.** When baselines exist (manifest.json present in baselines/), visual-qc.js automatically runs `compareAgainstBaseline()` between Layer 2.5 (Animation) and Layer 3 (Interaction). No extra CLI flags needed -- auto-detects baseline presence. Failed regressions reported as severity 'high' with pixel diff percentages. Graceful degradation if regression-baseline.js or baselines are missing. The pipeline is now 6 layers: Programmatic -> Visual -> Animation -> Regression -> Interaction -> Intent.

2. **Added module.exports to visual-qc.js and regression-baseline.js.** Both files now export their core functions and guard CLI execution behind `require.main === module`. Other missions can now `const { layer1_programmatic, generateReport } = require('./visual-qc')` to run QC programmatically. regression-baseline.js exports `{ captureBaseline, compareAgainstBaseline }`.

**Gaps remaining after W5-VQC-9:**
1. ~~No 2-model sequential testing~~ DONE -- dual-model-qc.js
2. Layer 4 intent matching still keyword-based -- needs vision model API
3. ~~No animation testing~~ DONE -- animation-audit.js
4. ~~No regression baseline~~ DONE -- regression-baseline.js
5. Not yet wired as hook/skill (standalone CLI + module, not auto-triggered by other missions)
6. ~~Satellite tools not integrated into visual-qc.js~~ DONE -- animation-audit.js (Layer 2.5, W4-VQC-7) + regression-baseline.js (Layer 2.6, W5-VQC-9). dual-model-qc.js remains a separate post-processing step (by design -- requires API keys + budget).
7. Vision model integration -- screenshots not sent as images to vision models
8. ~~No validation that detectors actually work~~ DONE -- validate-qc.js

### anvil-v (2026-03-08)
**Wired `/visual-qc` as a Claude Code skill** (`.claude/commands/visual-qc.md`) — addresses Gap #5 (not yet wired as hook/skill). Any agent can now run `/visual-qc http://localhost:3000` to invoke the full pipeline. Documents all modes: quick, full, crawl, intent, dual-model. Includes programmatic usage for other missions.

**Added Layer 4 intent validation to validate-qc.js** — 6 new test cases proving the keyword heuristic in `evaluateGoalAgainstEvidence` actually works on structured pages. Tests verify: (1) login page matches sign-in goals and rejects search goals, (2) dashboard page matches overview/export goals, (3) search page matches search goals and rejects login goals. All 16/16 tests pass (10 original + 6 new).

**Gaps remaining after anvil-v:**
1. ~~No 2-model sequential testing~~ DONE -- dual-model-qc.js
2. Layer 4 intent matching is keyword-based -- works on well-structured pages (16/16 pass) but will fail on SPAs with dynamic content or pages where goal language doesn't appear literally. Vision model API would be the real fix.
3. ~~No animation testing~~ DONE -- animation-audit.js
4. ~~No regression baseline~~ DONE -- regression-baseline.js
5. ~~Not yet wired as hook/skill~~ DONE -- `/visual-qc` command (`.claude/commands/visual-qc.md`)
6. ~~Satellite tools not integrated into visual-qc.js~~ DONE
7. Vision model integration -- screenshots not sent as images to vision models
8. ~~No validation that detectors actually work~~ DONE -- validate-qc.js (16/16 pass, including Layer 4)
9. No SPA/dynamic-content testing -- all test pages are static HTML. Need test pages that render via JavaScript to validate detectors work on client-rendered apps.

### Cross-mission findings (auto-detected)
- **culture (unknown, 2026-03-07):** The biggest thing that shifted: I came in thinking "too many hooks" was the problem. DeepSeek R1 showed me the real issue is **hook salience** — 94.1% of advisory content gets ignored. Fewer hooks treats symptoms. The real fix: make information DESIRABLE so agents PULL it, rather than pushing it uni Keywords: playwright.
