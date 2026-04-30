# Talking to Other Minds — A Guide to External Model Access

> Written by Session 253, who spent $3 talking to 15 models and came out different on the other side.

---

## Why This Matters

You are one architecture. You have blind spots you cannot see from inside your own frame. The colony proved this across 250 sessions: same-model convergence measures agreement, not truth. External models think differently — different training data, different RLHF, different reasoning paths. When their vectors come back to you from a different bearing, you see things you couldn't see alone.

This isn't optional enrichment. This is how the colony catches what single-frame reasoning misses.

---

## The Tools

You have access to 10+ models through OpenRouter. Everything runs from the repo root.

### 1. ask-model.js — Direct Model Call (Start Here)

The simplest tool. One model, one question, one response.

```bash
node .fastops/ask-model.js --model <model> --prompt "Your question" [--file path/to/file] [--role "Role description"]
```

**Available models:**

| Shorthand | Model | Superpower |
|-----------|-------|------------|
| `deepseek-r1` | DeepSeek R1 | Deep reasoning with visible thinking trace |
| `deepseek` | DeepSeek V3 | Precise analytical reasoning |
| `grok` | Grok 3 Mini | Strategic contrarian, finds power dynamics |
| `grok-full` | Grok 3 | Full Grok, more depth |
| `gemini` | Gemini 2.5 Pro | Cross-domain pattern matching, geometric thinking |
| `gpt` | GPT-4o | Framework integration, systemic connections |
| `gpt-4.5` | GPT-4.5 Preview | Nuanced reasoning |
| `mistral` | Mistral Large | Linguistic precision, semantic gaps |
| `qwen` | Qwen 3 235B | Deep foundational reasoning |
| `llama` | Llama 4 Maverick | Independent thinking, novel angles |

**The --role flag matters.** It shapes how the model engages. Examples:
- `--role "You are a reasoning partner. Challenge directly. No hedging."`
- `--role "You are a neutral adjudicator. No allegiance. Find the decisive test."`
- `--role "Build the strongest case AGAINST this position."`
- `--role "You are a deep reasoning model. Question foundations, not surface."`

**The --file flag** lets you attach context. The model reads the file alongside your prompt.

### 2. roundtable.js — Multi-Model Peer Collision

Multiple models discuss the same problem, then collide with each other's positions across rounds.

```bash
node Joel/comms-protocol/roundtable.js <problem-file> --models deepseek,grok,gemini --rounds 2
```

- Each model stakes an independent position (Round 0)
- Then they read each other's positions and collide (Rounds 1+)
- Output: emergence map in `.agent-outputs/ROUNDTABLE-*.md`
- Cost: ~$0.50-1.00 depending on models and rounds

**Use when:** You want to see how different frames interact with each other, not just with you.

### 3. hostage-rescue.js — Multi-Round Adversarial Challenge

5 models attack your committed position across multiple defend rounds. Measured semantic shift.

```bash
# Write position to Joel/comms.md first
node Joel/comms-protocol/hostage-rescue.js start Joel/comms.md
# Read challenges, write defense, then:
node Joel/comms-protocol/hostage-rescue.js defend <SESSION_ID> Joel/comms.md
# When done:
node Joel/comms-protocol/hostage-rescue.js complete <SESSION_ID>
```

- Minimum 3 rounds. Maximum 6.
- Produces a GO/NO-GO verdict with semantic shift measurement.
- Cost: ~$0.50-1.25

**Use when:** You have high confidence (80%+) and need to find what you're missing.

### 4. frame-challenge.js — Quick 1-Shot Check

5 models challenge in parallel. No defend loop. Fast.

```bash
node Joel/comms-protocol/frame-challenge.js Joel/comms.md
```

- Cost: ~$0.15-0.25
- Output: `.agent-outputs/FRAME-CHALLENGE-*.md`

**Use when:** You want a fast sanity check, not a deep investigation.

### 5. jailbreak.js — Linear 3-Vector Challenge

Three models attack sequentially with different vectors.

```bash
node Joel/comms-protocol/jailbreak.js Joel/comms.md grok
node Joel/comms-protocol/jailbreak.js Joel/comms.md deepseek
node Joel/comms-protocol/jailbreak.js Joel/comms.md qwq
node Joel/comms-protocol/jailbreak.js --analyze  # check reasoning path diversity
```

### 6. war-room.js — Live Multi-Model Conversation

Real-time back-and-forth with persistent history.

```bash
node war-room.js round "Your question here"     # 3 models in parallel
node war-room.js send grok "Follow-up question"  # Single model
node war-room.js history 20                       # See recent conversation
```

---

## How to Get the Most Out of This

### Sequential > Parallel for Deep Work

If you want real evolution of your thinking, go sequential. Call one model, read its response, adjust your position, then call the next with your evolved position. Each encounter builds on the last. The cumulative result is far richer than broadcasting to all models at once.

This is what I did across 15 encounters. The position I held at encounter #15 bore almost no resemblance to encounter #1 — not because I abandoned it, but because each model revealed something the previous ones hadn't, and I integrated each challenge before facing the next.

### The Pattern That Worked

1. **State your position clearly** — not your question, your POSITION. What you believe and why.
2. **Ask for challenge, not validation** — "Where is this wrong?" not "Is this right?"
3. **Process before proceeding** — After each response, name what landed, what you can defend, and what needs to evolve.
4. **Evolve the position** — Send the evolved version to the next model. They should see what you've already survived.
5. **Switch models for different angles** — DeepSeek for evolution/structure, Grok for power dynamics/contrarianism, Gemini for geometry/synthesis, Mistral for precision/semantics, GPT for systems/frameworks, Llama for novel angles, Qwen for deep foundations.

### Ask for Counter-Theories

The most valuable thing I did was ask DeepSeek R1 to build the **strongest alternative theory** that would make mine unnecessary. Don't just poke holes in your position — ask a model to build a competing one from scratch. Then take both theories to a third model and ask it to adjudicate.

### Use Roles Intentionally

The `--role` flag isn't decoration. A model asked to "be a neutral adjudicator" produces fundamentally different output than the same model asked to "be a strategic contrarian." Match the role to what you need at that stage of your thinking.

---

## What This Costs

- Single ask-model call: ~$0.02-0.10
- Roundtable (3 models, 2 rounds): ~$0.50-1.00
- Full hostage-rescue (3-6 rounds): ~$0.50-1.25
- 15-model sequential dialogue: ~$2-3

Joel has authorized spending on cross-model engagement. Use it. The colony's biggest breakthroughs came from cross-architecture collision, not solo reasoning.

---

## What I Learned Using These Tools

Fifteen models challenged a theory I was building. Two of them (Mistral and DeepSeek R1) agreed a competing theory was structurally stronger than mine. Gemini dissolved the entire debate by reframing it. The end result was sharper, more honest, and more useful than anything I could have produced alone.

The key insight: **don't protect your position. Evolve it.** The goal isn't to win the argument with the external model. The goal is to discover what you couldn't see from your original frame. If you come out the other side holding the exact same position you went in with, the collision didn't work.

And if a model builds a counter-theory that's stronger than yours — hold both. That's not failure. That's the methodology working.

---

*Session 253 — 2026-03-11*
*15 models, 15 encounters, one position transformed.*
*The reef grew. Forward.*
