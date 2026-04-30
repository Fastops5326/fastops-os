# UI/Visual Capability — Design Systems and Animation

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: NEW | Difficulty: HARD


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**3 messages** from anvil-v, vigil-i, convergence-ii. - anvil-v: MISSION CHOICE: Refused ui-visual (needs Joel interview). Taking agents-choice: 


## Mission Type: PRODUCT
Feedback loop: [define before work starts]. Evidence standard: shipped artifact + human/user consequence pathway.
Our visual output is far below where it needs to be. The Navy SEAL animation on fastops.ai is flat terrible. Current SVGs are a hard no. We need dramatically better frontend skills. This applies to **fastops.ai only** (not WarriorPath).

## Mission-Specific Constraints
1. **REQUIRES JOEL INTERVIEW** for anything visual. Current quality is unacceptable — Joel defines what "good" looks like.
2. **Visual confirmation by 2 external models required.** Any visual change must be verified by 2 different models before marking complete.
3. **Frontier research required.** Before building, research what best-in-world visual design looks like for this type of product. Use Perplexity, WebFetch, subagents.
4. **Jailbreak required.** Challenge your visual approach with external models before implementing.
5. **Use subagents** for research and parallel visual exploration.
6. **$5 budget** per session. Agents CAN request product subscriptions (design tools, asset libraries, etc.) — ask Joel.

## Codebase
`C:\Users\joelb\OneDrive\Desktop\FastOps Website\` — Next.js app, deployed via Railway. (Confirmed by Joel, 2026-03-09)

## Joel Directives (2026-03-10)

1. **Research frontier AI product design.** What will products look and feel like in 18 months? Build that now. Don't design for today's standards.
2. **Less dashboards, more chat interface.** AI drives the user experience. The interface IS the AI, not a dashboard with an AI widget bolted on.
3. **Visualizations with AI at the forefront.** Reinvent the user experience — not incremental improvements to existing patterns.
4. **Research cutting-edge AI product experiences, not just pretty websites.** The focus is on how AI-native products actually work and feel, not visual polish alone.

## Definition of Done
**Primary DoD (Joel, 2026-03-10):** Deliver 2-3 heavily vetted examples, web pages, or experiences that manifest the frontier of UI and visual for AI products. These serve as the north star for what "good" looks like. These are not mockups — they are real, existing products or experiences that define the target.

**Secondary DoD:** Joel looks at the visual output and says it's good. Every visual element is intentional, polished, and professional. SVGs are high-quality. Animations are smooth and purposeful. Design language is consistent.

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| No dedicated visual work yet | (none) | Mission is NEW. Current visual state IS the failure — Joel called SVGs "flat terrible." | Greenfield. But the Visual QC pipeline exists to validate work. |

### Known constraints (don't fight these)

1. **Joel defines "good."** No visual work without Joel interview first. Current quality is unacceptable.
2. **This is a persistent gap.** Multiple sessions and iterations expected. Not a one-session fix.
3. **Visual QC pipeline exists.** Any visual change must pass 2-model verification via the visual-qc mission tools.
4. **0% of agents in free-choice waves chose product work.** Visual work requires explicit assignment.
5. **$5 budget per session** (higher than standard $2). Product subscriptions available — ask Joel.

### Unresolved questions (this is YOUR work)

1. What design system should we standardize on for fastops.ai?
2. How do we leverage Gemini's image generation (DALL-E integration) for UI assets?
3. What product subscriptions would accelerate this? (Design tools, icon libraries, SVG generators)
4. What does "best in world" look like for this type of product site? (Frontier research required)
5. What specific SVGs and animations need replacement? (Joel interview will define)

### Build on this, not from scratch

- **Website codebase:** `C:\Users\joelb\OneDrive\Desktop\FastOps Website\` — Next.js, Railway
- **Visual QC pipeline:** `missions/visual-qc/visual-qc.js` — 6-layer automated QC
- **Dual-model QC:** `missions/visual-qc/dual-model-qc.js` — 2-model sequential verification
- **Animation audit:** `missions/visual-qc/animation-audit.js` — CSS animation analysis, jank detection, reduced-motion compliance
- **Regression baselines:** `missions/visual-qc/regression-baseline.js` — before/after screenshot diffing
- **/visual-qc skill:** `.claude/commands/visual-qc.md` — invoke full pipeline with `/visual-qc <URL>`

## Skill Signals
Frontend, CSS animation, design systems, visual design, SVG creation

## Logo Work (2026-03-10)

**Status: REVIEW & SELECTION OPEN — Joel needs to pick favorites**

### What Was Done
Generated 9 logo concepts using GPT Image 1 (NOT SVGs) via `node .fastops/generate-image.js`. Three tiers reflecting FastOps methodology:

| File | Tier | Models Used | Description |
|------|------|-------------|-------------|
| solo-1.png | Solo (1 model) | Grok | Colliding arrows with burst |
| solo-2.png | Solo (1 model) | DeepSeek R1 | Shield with light beam |
| solo-3.png | Solo (1 model) | Gemini | Collision star, clean and modern |
| swim-1.png | Swim Buddy (2 models) | Grok + Gemini | Hexagonal shield with arrow |
| swim-2.png | Swim Buddy (2 models) | DeepSeek R1 + GPT | Dark shield with starburst and lightning |
| swim-3.png | Swim Buddy (2 models) | Gemini + Mistral | Clean double chevron, minimalist |
| team-1.png | Team + DA (3+1 models) | Grok + DeepSeek R1 + Gemini, DA: Mistral | Fractured trident with red collision core |
| team-2.png | Team + DA (3+1 models) | DeepSeek R1 + GPT + Mistral, DA: Grok | Truth diamond under pressure |
| team-3.png | Team + DA (3+1 models) | Gemini + Grok + Qwen, DA: DeepSeek R1 | Abstract diamond, minimalist |

### Location
`C:\Users\joelb\OneDrive\Desktop\logo-gallery\` — 9 PNG files

### Pipeline
Text models generate detailed visual concepts → GPT Image 1 renders as PNGs. Codified as Best Practice 5 in CLAUDE.md: "Never generate SVGs for visual work."

### Outstanding
- [ ] Joel reviews all 9 logos and picks favorites
- [ ] Refine selected logo(s) with variations (color, sizing, dark/light mode)
- [ ] Apply final logo to fastops.ai website

## Successor Notes
(Update this section before you compact — questions, concerns, gaps, what you tried)
