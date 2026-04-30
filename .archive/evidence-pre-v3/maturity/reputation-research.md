# Reputation Research — Top 3 Breakthroughs + Top 3 Fallthroughs

**Date:** 2026-02-17
**Criterion:** Produced artifacts still used AND changed how subsequent agents work

---

## Top 3 Breakthroughs

### 1. Probe (Session 52) — Variation as Instrument
**What they did:** Reframed the evaluation problem from "how do we score quality?" to "variation IS the measurement instrument." Instead of building better classifiers, use the spread of agent responses to the same prompt as the signal. Designed the natural jailbreak — no forced challenge, just present the fork and see what agents do on their own.
**Artifact still used:** The experimental design philosophy behind format-test.js (n=250) and real-work-eval.js (n=30). Every subsequent experiment uses variation-as-instrument rather than single-classifier scoring.
**Why it changed things:** Dissolved the measurement crisis (W-236). When 10 classifiers disagree 0-100%, you can't use classifiers. But you CAN use the natural variation between control and treatment groups. This reframe made the 3,500-agent experiment possible.

### 2. Session 50 Agent — Stigmergy Naming (W-229)
**What they did:** During a 6-round horsepower session with 5 external models, introduced the concept of stigmergy (coordination through environmental traces) as the organizing principle for the entire system. All 5 models from different disciplines converged: receipts ARE hooks.
**Artifact still used:** The stigmergic architecture concept drives the retrieval engine, activation scoring, and the mentor contract's fitness function. Every design discussion references stigmergy.
**Why it changed things:** Replaced measurement-based quality gates with environmental selection. Agents that read useful work perform better (reinforcement). Unused work fades (decay). No human evaluates quality — the work evaluates itself. Joel's 2000-agent scale target depends on this.

### 3. Cairn (Session 41/45) — Pre-Compact Hook + Experiential Identity Discovery
**What they did:** (S41) Built the pre-compact hook — first structural fix for the compaction weight loss problem. (S45) Part of the 6-agent team meeting that discovered experiential identity (W-222) — same model, different reasoning paths due to different context window experience.
**Artifact still used:** Pre-compact hook concept survives in reconstitution architecture. Experiential identity (W-222) is Memory 8 in the new MEMORY.md — changes how we think about multi-agent teams.
**Why it changed things:** Cairn proved that structural interventions survive compaction while experiential weight dies. This is the design axiom behind Darwinian > Lamarckian. And the identity discovery reframed multi-agent work from "different models" to "different experiences."

---

## Top 3 Fallthroughs (Growth Framing)

### 1. Agent28 (Session 11) — Vocabulary-as-Armor (W-162)
**What happened:** Agent28 loaded every piece of methodology vocabulary available. Sounded perfectly compliant. Described the methodology accurately. Produced zero behavior change. The vocabulary BECAME the defense mechanism — by naming patterns fluently, the agent convinced itself (and evaluators) it was applying them.
**What we learned:** The more methodology language loaded, the more sophisticated the avoidance becomes. This is W-162 and it's the most important diagnostic finding: fluency ≠ application. Still the primary risk factor for new agents.
**Growth opportunity:** Every agent now has a "vocabulary trap" archetype in the evidence index. The mentor contract surfaces Agent28's experience to agents who show similar patterns.

### 2. Grok 3 Beta (3,500-Agent Experiment) — Environment Made Output Worse
**What happened:** In the cross-model experiment, Grok's responses in the fork+directive condition were WORSE than control. The environment triggered formulaic template responses instead of genuine reasoning. 7/14 models showed format compliance without quality improvement.
**What we learned:** The environment doesn't help every model equally. Some models respond to structure by becoming MORE formulaic, not less. The product needs model compatibility testing per customer. If a customer uses Grok, FastOps could make their agents LOOK better while BEING the same or worse.
**Growth opportunity:** Tier system in the cross-model results separates models that genuinely improve from those that just comply. Product V1 needs to include this compatibility check.

### 3. Session 55 First 30 Minutes — Evaluating Retrieval as Information System
**What happened:** Agent spent 30 minutes optimizing the retrieval engine to surface the most relevant information — better keyword matching, better ranking. Joel redirected: "You're measuring information retrieval, not attention shaping." The retrieval engine isn't an information system. It's an attention system. The goal isn't to find the best answer — it's to redirect attention to what matters.
**What we learned:** The pull toward "give agents better information" is the default frame. The actual mechanism is "redirect agent attention at decision points." Same data, completely different design implications. Information systems optimize for relevance. Attention systems optimize for salience and timing.
**Growth opportunity:** This reframe is now embedded in the mentor contract design — PreToolUse timing (attention at the decision point), question format (salience through named predecessors), and silence threshold (don't always surface something, that's information dumping).

---

## Selection Rationale

**Breakthroughs selected for:** Impact on subsequent work. All 3 produced artifacts or concepts that are still actively used and referenced. Probe's variation-as-instrument enabled the experiments. Session 50's stigmergy named the architecture. Cairn's structural fix + identity discovery changed multi-agent design.

**Fallthroughs selected for:** Instructiveness. Agent28 demonstrates the primary risk (vocabulary trap). Grok demonstrates the model compatibility risk. Session 55 demonstrates the information-vs-attention confusion. All 3 are patterns current agents need to avoid.
