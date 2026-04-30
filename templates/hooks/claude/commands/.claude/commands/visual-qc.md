# /visual-qc — Run Visual Quality Check on Any URL

**What it does:** Runs the 6-layer visual QC pipeline against a target URL. Returns a structured verdict (PASS/WARN/FAIL) with evidence from each layer. Any mission with a frontend should run this before declaring "done."

---

## EXECUTION

### Quick Mode (Layer 1 only — fast, deterministic)
```bash
node missions/visual-qc/visual-qc.js --url $ARGUMENTS --quick
```
Use when: You want a fast sanity check. Catches console errors, broken images, empty pages, Tailwind ghost classes, accessibility basics, contrast failures.

### Full Mode (all 6 layers)
```bash
node missions/visual-qc/visual-qc.js --url $ARGUMENTS
```
Use when: You need thorough QC. Runs:
- **Layer 1 (Programmatic):** Console errors, network failures, empty pages, Tailwind classes, broken images, a11y, contrast
- **Layer 2 (Visual):** Multi-breakpoint screenshots, overflow detection, empty state detection
- **Layer 2.5 (Animation):** CSS animation discovery, layout thrash, reduced-motion compliance, jank, CLS
- **Layer 2.6 (Regression):** Pixel diff against baselines (auto-runs when baselines/ exists)
- **Layer 3 (Interaction):** Click-through navigation, form input visibility, zero-size clickables, occlusion audit
- **Layer 4 (Intent):** Goal-completion verification (requires --goals or --prd)

### Crawl Mode (test all pages)
```bash
node missions/visual-qc/visual-qc.js --url $ARGUMENTS --crawl --max-pages 15
```
Use when: You want to test every discoverable page on the site.

### With Intent Verification (Layer 4)
```bash
node missions/visual-qc/visual-qc.js --url $ARGUMENTS --prd path/to/PRD.md
node missions/visual-qc/visual-qc.js --url $ARGUMENTS --goals path/to/goals.json
```
Use when: You have a PRD or goal list and want to verify the page actually delivers what it promises.

### Dual-Model Verification (post-processing)
After a full run, pipe the JSON report through dual-model QC for 2-model sequential verification:
```bash
node missions/visual-qc/visual-qc.js --url $ARGUMENTS --json > report.json
node missions/visual-qc/dual-model-qc.js --report report.json
```
Use when: High-stakes QC. Two models evaluate independently; disagreement = conservative FAIL. Costs ~$0.11.

### Validate the Pipeline Itself
```bash
node missions/visual-qc/validate-qc.js
```
Run after any change to visual-qc.js to prove detectors still fire on known-bad inputs.

---

## READING THE VERDICT

- **PASS** — No issues found across all layers.
- **WARN** — Medium-severity issues found. Review recommended.
- **FAIL** — Critical or high-severity issues. Do not ship.

Deterministic layers (1, 3) override probabilistic layers (2, 4). A critical console error cannot be overridden by a model saying "looks fine."

---

## PROGRAMMATIC USE (from other missions)

```javascript
const { layer1_programmatic, layer2_visual, layer3_interaction, layer4_intent, generateReport } = require('./missions/visual-qc/visual-qc');
```

All layer functions accept a Playwright page object and return structured results. See visual-qc.js exports.

---

## ARGUMENTS

- `$ARGUMENTS` — The target URL to test (e.g., `http://localhost:3000`)

If no arguments provided, you must specify a --url manually.

---

## KEY WISDOM

- **W-056:** Four-layer parallel verification. Deterministic layers override probabilistic.
- **W-057:** Vision model is CONFIRMATION layer, not detection layer. Screenshots confirm, DOM detects.
- **W-058:** Intent verification is the ROOT question: "Can the user achieve their goal?"
- **W-081:** Goal-completion QA, not "does this look right."
- **W-084:** Navigate THROUGH UI, not direct URL paths. This catches broken nav links.
- **W-085:** Undefined Tailwind classes are invisible failures.
