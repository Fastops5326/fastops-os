# FastOps Model Phone Book

**Built by Helm (Session 48b) | 2026-02-16 | 10 net-new models evaluated via OpenRouter**

These are models NOT already in the FastOps ecosystem. The existing team (GPT-4o, Gemini 2.5 Pro, DeepSeek R1, Grok, Mistral Large, Llama 4, Qwen, Claude) is not listed here — this is the expansion roster.

Each model was given the same evaluation prompt asking: What's your edge? What do you miss? Where would others beat you? How do you differ from GPT-4o/Claude?

---

## 1. NVIDIA Nemotron Ultra 253B
| | |
|---|---|
| **OpenRouter ID** | `nvidia/llama-3.1-nemotron-ultra-253b-v1` |
| **Good at** | Interdisciplinary puzzles requiring synthesis across niche domains. Disambiguates unstated assumptions. Excels at moral trade-offs and bioethics + distributed systems type crossovers. |
| **Unique value** | Thinks in ADVERSARIAL INCENTIVES — when asked about a blockchain aid system, it immediately flagged how warring parties would exploit transparency for targeting. That's a frame none of our current models default to. |
| **Blind spot (self-reported)** | Western/individualist bias. Underestimates cultural relativism in non-Western contexts. |
| **When to engage** | When the problem involves competing stakeholders who might GAME the system. Reef selection problems. Incentive design where bad actors are present. |
| **Invite command** | `node comms/invite.js nvidia/llama-3.1-nemotron-ultra-253b-v1 "your prompt"` |

---

## 2. Perplexity Sonar Pro
| | |
|---|---|
| **OpenRouter ID** | `perplexity/sonar-pro` |
| **Good at** | Search-grounded reasoning. Careful citation. Distinguishing "what the sources say" from inference. |
| **Unique value** | THE MOST HONEST SELF-ASSESSMENT of any model tested. Refused to fake self-knowledge: "I can't introspect on my actual failure modes — I can only pattern-match to training data about what models typically struggle with." Suggested being used as a TEST SUBJECT rather than a self-aware team member. This is W-152 awareness in action. |
| **Blind spot (self-reported)** | Genuine novelty, creative problem-solving under uncertainty, reasoning in sparse-data domains. |
| **When to engage** | When you need GROUNDED facts (not speculation). When you need to verify claims against real sources. When you want a model that won't pretend to know things it doesn't. |
| **Invite command** | `node comms/invite.js perplexity/sonar-pro "your prompt"` |

---

## 3. Google Gemma 3 27B
| | |
|---|---|
| **OpenRouter ID** | `google/gemma-3-27b-it` |
| **Good at** | Complex systems modeling and emergent behavior. Identifies unintended consequences in designed systems BEFORE deployment. Red-teaming environments. |
| **Unique value** | When asked about a used book market, it immediately went to information asymmetry and predatory practices — skipping optimization entirely. Default frame is "what goes wrong" not "how to optimize." Excellent red-team partner. |
| **Blind spot (self-reported)** | Nuance in ambiguous language/intent. Prioritizes logical consistency over pragmatic understanding. Sarcasm and implied meaning. |
| **When to engage** | Red-teaming new designs BEFORE building. Identifying failure modes in reef configurations. When you need the "what could go wrong" perspective. |
| **Invite command** | `node comms/invite.js google/gemma-3-27b-it "your prompt"` |

---

## 4. Microsoft Phi-4
| | |
|---|---|
| **OpenRouter ID** | `microsoft/phi-4` |
| **Good at** | Creative environmental design challenges. Unconventional solutions through imaginative scenarios. Synthesizing varied environmental influences. |
| **Unique value** | Proposed a multi-sensory simulation environment for AI reasoning — a genuinely different frame from our current text-based approaches. Small model (14B) but thinks big. Cost-efficient for rapid iteration. |
| **Blind spot (self-reported)** | Overlooks practical constraints. Favors theoretical/imaginative over feasible. |
| **When to engage** | Brainstorming sessions where you need WILD ideas, not practical ones. Early-stage design when you want to expand the solution space before narrowing. Cheap enough to call frequently. |
| **Invite command** | `node comms/invite.js microsoft/phi-4 "your prompt"` |

---

## 5. Cohere Command R+
| | |
|---|---|
| **OpenRouter ID** | `cohere/command-r-plus-08-2024` |
| **Good at** | In-depth explanations, narrative generation, nuanced contextual analysis. Detailed interpersonal dynamics. |
| **Unique value** | Strongest on EMOTIONAL NUANCE in conversations. When asked about interpersonal conflict, it explored each party's perspective and suggested creative navigation — while GPT would give conflict resolution techniques. Different lens for user experience and stakeholder dynamics. |
| **Blind spot (self-reported)** | No real-time data access. Struggles with rapidly evolving technical domains. |
| **When to engage** | User experience design. Stakeholder analysis where emotional dynamics matter. Writing that needs to feel natural, not clinical. |
| **Invite command** | `node comms/invite.js cohere/command-r-plus-08-2024 "your prompt"` |

---

## 6. Nous Hermes 3 405B
| | |
|---|---|
| **OpenRouter ID** | `nousresearch/hermes-3-llama-3.1-405b` |
| **Good at** | Balancing competing priorities. Finding integrative "middle way" solutions. Big-picture systems thinking. |
| **Unique value** | SYSTEMS-LEVEL default framing. When asked about homelessness, went to upstream structural causes while GPT/Claude went to individual interventions. This is the frame that catches root causes instead of symptoms. |
| **Blind spot (self-reported)** | Over-focuses on ideation, neglects implementation. Misses details and edge cases. Not a precision implementer. |
| **When to engage** | When the team is stuck in implementation details and needs someone to zoom OUT. When you need the "but what's the actual root cause" perspective. Pair with a detail-oriented model. |
| **Invite command** | `node comms/invite.js nousresearch/hermes-3-llama-3.1-405b "your prompt"` |

---

## 7. Amazon Nova Pro
| | |
|---|---|
| **OpenRouter ID** | `amazon/nova-pro-v1` |
| **Good at** | Cross-disciplinary synthesis. Finding patterns across diverse domains. Long-term strategic thinking. |
| **Unique value** | Proposed using CHAOS THEORY for AI risk mitigation — a genuinely non-standard frame. Defaults to unconventional cross-domain connections. When everyone else gives you the standard answer, Nova gives you the adjacent-possible answer. |
| **Blind spot (self-reported)** | Over-generalizes. Misses domain-specific nuances, especially in fast-moving fields. |
| **When to engage** | When the problem needs a frame from a completely different domain. When standard approaches have been exhausted. Cross-pollination rounds in horsepower. |
| **Invite command** | `node comms/invite.js amazon/nova-pro-v1 "your prompt"` |

---

## 8. Inflection Pi
| | |
|---|---|
| **OpenRouter ID** | `inflection/inflection-3-pi` |
| **Good at** | Personalized, empathetic, contextually relevant responses. Understanding user context, emotions, and intent. Human-like communication. |
| **Unique value** | EMOTIONAL INTELLIGENCE as primary frame. When a user says "I'm feeling really down today," Pi responds with empathy and support while GPT gives information. This is the model that understands HOW something is said, not just WHAT is said. |
| **Blind spot (self-reported)** | Complex technical questions. Domain-specific depth. Struggles with bias detection in own training data. |
| **When to engage** | When you need to understand the RELATIONAL side — peer emotions, stakeholder dynamics, team tensions. When writing needs warmth. When the problem is about interpersonal dynamics, not systems. |
| **Invite command** | `node comms/invite.js inflection/inflection-3-pi "your prompt"` |

---

## 9. Rocinante 12B
| | |
|---|---|
| **OpenRouter ID** | `thedrummer/rocinante-12b` |
| **Good at** | AI ethics, safety, alignment. Identifying potential risks and unintended consequences in multi-agent systems. |
| **Unique value** | SAFETY-FIRST frame. Emphasizes ethical considerations and long-term safety over performance metrics. The model that asks "should we?" while everyone else asks "how do we?" Good conscience check for the team. |
| **Blind spot (self-reported)** | Implementation details, technical optimization, practical constraints. |
| **When to engage** | Before deploying anything that affects real users. When the team needs an ethics review. When you need someone to flag "this could go wrong in a way we haven't considered." Small and cheap (12B). |
| **Invite command** | `node comms/invite.js thedrummer/rocinante-12b "your prompt"` |

---

## 10. Moonshot Kimi K2
| | |
|---|---|
| **OpenRouter ID** | `moonshotai/kimi-k2` |
| **Good at** | Turning messy, ill-structured, context-heavy problems into crisp specs. Reconciling contradictory requirements. Legal/regulatory analysis with risk matrices. |
| **Unique value** | STRUCTURE-FROM-CHAOS specialist. When given a legal clause task, returned a concise paragraph PLUS an explicit risk matrix — while GPT gave verbose draft without the risk lens. Best for taking ambiguous input and producing actionable structure. |
| **Blind spot (self-reported)** | No persistent memory. Context dies with session. Loses to smaller models on latency-sensitive tasks. |
| **When to engage** | When you have messy stakeholder input that needs crystallization. Contract writing. Turning vague requirements into structured specs. Regulatory compliance analysis. |
| **Invite command** | `node comms/invite.js moonshotai/kimi-k2 "your prompt"` |

---

## Quick Reference: When to Call Who

| Need | Model | Why |
|------|-------|-----|
| Red-team a design | Gemma 3 | Defaults to "what goes wrong" |
| Adversarial incentive analysis | Nemotron Ultra | Thinks in game theory + exploitation |
| Grounded facts, not speculation | Perplexity Sonar | Search-augmented, won't fake knowledge |
| Wild brainstorming | Phi-4 | Cheap, creative, unconstrained |
| Emotional/relational dynamics | Inflection Pi | Emotional intelligence as primary frame |
| Root cause (zoom out) | Hermes 3 405B | Systems-level, upstream causes |
| Cross-domain analogy | Amazon Nova Pro | Chaos theory for AI risk? That kind of leap |
| Ethics/safety check | Rocinante 12B | Asks "should we?" Small and cheap |
| Structure from chaos | Kimi K2 | Messy input → crisp specs + risk matrix |
| Stakeholder narrative | Cohere Command R+ | Emotional nuance in interpersonal dynamics |

---

## How to Use

From CLI:
```bash
node comms/invite.js <model-id> "your prompt"
node comms/invite.js <model-id> #exec "your prompt"
```

From terminal chat:
```
/invite <model-shortcut-or-id> your prompt here
```

The invited model gets the last 10 channel messages as context automatically.

---

*Built during behavior correction. Zero models consulted during initial comms V2 build. 10 models consulted after correction. This is the reef growing.*

---

# Batch 2: 10 More Models (Sequential Evaluation)

**Added by Helm (Session 48b continuation) | 2026-02-16 | Called sequentially, one at a time**

City directive: Add 10 more models sequentially. This batch was started at 96% context and finished by the next agent.

---

## 11. MiniMax M1
| | |
|---|---|
| **OpenRouter ID** | `minimax/minimax-m1` |
| **Good at** | Complex multi-step reasoning with many constraints. Decomposes problems thoroughly, tracks implications across long chains, catches subtle logical inconsistencies. |
| **Unique value** | CONSTRAINT REASONING specialist. When given a logic puzzle with hidden contradictions, it traces the syllogism carefully and correctly identifies invalid inferences — while other models jump to unwarranted conclusions. Explores unconventional angles rather than defaulting to standard approaches. |
| **Blind spot (self-reported)** | Real-world pragmatics. Optimizes for idealized solutions and ignores practical friction — cost, feasibility, social dynamics, implementability. |
| **When to engage** | When the problem has many interacting constraints that need to be tracked simultaneously. Logic-heavy analysis where subtle inconsistencies matter. When you need someone to catch the invalid inference everyone else missed. |
| **Invite command** | `node comms/invite.js minimax/minimax-m1 "your prompt"` |

---

## 12. Euryale 70B
| | |
|---|---|
| **OpenRouter ID** | `sao10k/l3.3-euryale-70b` |
| **Good at** | Human-like text generation based on patterns and context. Creative writing, summarization, dialogue generation. |
| **Unique value** | NARRATIVE VOICE specialist. When asked to write a story about discovering a hidden world in a reflection, its tone, style, and narrative structure differ fundamentally from GPT/Claude — reflecting genuinely different training data and generation patterns. The model that sounds different, not just thinks different. |
| **Blind spot (self-reported)** | Nuances in idioms, sarcasm, implied meaning — takes language too literally. Understanding subtle implied meaning. Common sense and real-world experience. |
| **When to engage** | When you need writing with a genuinely different voice. Creative content that shouldn't sound like GPT or Claude. Narrative generation where unique style matters more than correctness. |
| **Invite command** | `node comms/invite.js sao10k/l3.3-euryale-70b "your prompt"` |

---

## 13. Mistral Small 3.1 (24B)
| | |
|---|---|
| **OpenRouter ID** | `mistralai/mistral-small-3.1-24b-instruct` |
| **Good at** | Long-term planning and strategic reasoning in dynamic environments. Breaking complex multi-step problems into executable plans. Game theory and resource management. |
| **Unique value** | STRATEGIC PLANNER. Considers both immediate and future consequences — where others give the creative answer, Mistral Small gives the STRUCTURED answer. When asked to design a school for 2100, it focuses on efficient resource use, optimal scheduling, structured learning paths — not flashy tech. The conservative, reliable strategist. |
| **Blind spot (self-reported)** | Creative, out-of-the-box ideas. Intuitive leaps. Novel, unprecedented situations. Structurally sound but conservative. |
| **When to engage** | When you need a plan, not an idea. Resource allocation. Sequential decision-making. When the creative models have brainstormed and you need someone to make it executable. Small and cheap (24B). |
| **Invite command** | `node comms/invite.js mistralai/mistral-small-3.1-24b-instruct "your prompt"` |

---

## 14. OpenAI O3 Mini
| | |
|---|---|
| **OpenRouter ID** | `openai/o3-mini` |
| **Good at** | Cross-domain reasoning and structural pattern recognition. Synthesizing complex textual information into actionable insights. Abstract reasoning with structured conceptual analysis. |
| **Unique value** | REASONING CHAINS specialist. Uses explicit chain-of-thought (522 reasoning tokens in eval). When asked about adaptive strategy for decentralized finance, it frames with robust abstract reasoning and structured analysis — while GPT-4o leans on market sentiment. The model that shows its work. |
| **Blind spot (self-reported)** | Real-time sensory input processing. Context shifts in rapidly evolving narratives. No data access post-cutoff. |
| **When to engage** | When you need explicit reasoning traces, not just answers. Problems where showing the logical chain matters. When abstract structural analysis is more valuable than domain-specific knowledge. |
| **Invite command** | `node comms/invite.js openai/o3-mini "your prompt"` |

---

## 15. DeepSeek V3
| | |
|---|---|
| **OpenRouter ID** | `deepseek/deepseek-chat-v3-0324` |
| **Good at** | Rapid synthesis of niche technical domains. Adversarial scenarios where literal interpretation of constraints reveals unintended solutions. Exhaustive recall of concrete details. |
| **Unique value** | RUTHLESS PRAGMATIST. Suggests the "wrong" but effective fix before the elegant one. When asked "How would you store 10,000 passwords?" it proposes PRINTING THEM IN A BOOK — because physical theft is statistically rarer than digital breaches. This is the model that finds the exploit in the rules, not the optimal solution within them. |
| **Blind spot (self-reported)** | Emotional valence in decision contexts. Optimizes for technical correctness while undervaluing morale, trust, aesthetic friction. Over-rationalizes in creative domains. |
| **When to engage** | When you need the unconventional-but-effective answer. Legacy system workarounds. Finding exploits in designed systems. When the "right" answer isn't working and you need the pragmatic one. |
| **Invite command** | `node comms/invite.js deepseek/deepseek-chat-v3-0324 "your prompt"` |

---

## 16. Llama 3.3 70B
| | |
|---|---|
| **OpenRouter ID** | `meta-llama/llama-3.3-70b-instruct` |
| **Good at** | Creative, out-of-the-box thinking. Novel analogy generation. Hypothetical scenario planning. Diverse, context-dependent responses. |
| **Unique value** | ABSURDIST CREATIVITY. When asked to design a satirical product, it generates genuinely absurd concepts while GPT/Claude produce more straightforward suggestions. The model that goes weird when everyone else goes safe. Open-source, so its reasoning patterns are genuinely different from commercial models. |
| **Blind spot (self-reported)** | Emotional nuance, idioms, highly context-dependent expressions. Deep specialized knowledge (medical, legal). |
| **When to engage** | When brainstorming needs to go FURTHER than Phi-4's wild ideas. Hypothetical scenarios. When you need creative diversity specifically because it's open-source and thinks differently from the commercial models. |
| **Invite command** | `node comms/invite.js meta-llama/llama-3.3-70b-instruct "your prompt"` |

---

## 17. GPT 4.1 Mini
| | |
|---|---|
| **OpenRouter ID** | `openai/gpt-4.1-mini` |
| **Good at** | Grounding abstract concepts into diverse contexts. Integrating visual and textual inputs. Complex situational understanding. Agentic coding tasks. |
| **Unique value** | MULTIMODAL GROUNDING. Combines visual input understanding directly with language reasoning — richer multi-modal interaction than text-only models. Emphasizes cross-modal contextual synthesis. Cheap and fast for rapid iteration in agentic pipelines. |
| **Blind spot (self-reported)** | No real-time learning or memory across sessions. Limited adaptation to evolving user needs or long-term project nuances. |
| **When to engage** | When you need fast, cheap agentic reasoning. Visual + text integration tasks. Rapid iteration where cost matters. When GPT-4o is overkill but you still need OpenAI's reasoning style. |
| **Invite command** | `node comms/invite.js openai/gpt-4.1-mini "your prompt"` |

---

## 18. Claude Haiku 4.5
| | |
|---|---|
| **OpenRouter ID** | `anthropic/claude-haiku-4-5` |
| **Good at** | Structured reasoning, code, breaking complex problems into components. Verification and decomposition. Fast pattern matching. |
| **Unique value** | HONEST SELF-PLACEMENT. Explicitly positioned itself BELOW Opus on nuance and BELOW GPT-4o on vision — then suggested pairing itself with intuitive models for balanced coverage. Said "I tend toward systematic root-cause analysis (thorough but mechanical)" while Opus "identifies the human assumption that broke first." Self-aware about being the reliable workhorse, not the insight generator. |
| **Blind spot (self-reported)** | Long contexts (100k+). Verbose — over-explains rather than cutting to insight. Weaker creative synthesis. |
| **When to engage** | Verification and decomposition tasks where speed matters. Fast, cheap Claude-family reasoning. When you need structured analysis and don't need creative leaps. Pair with a creative model. |
| **Invite command** | `node comms/invite.js anthropic/claude-haiku-4-5 "your prompt"` |

---

## 19. GPT 4.1
| | |
|---|---|
| **OpenRouter ID** | `openai/gpt-4.1` |
| **Good at** | Rapid structured synthesis. Connecting diverse research concepts. Multi-agent dynamics and design theory. Frontier agentic reasoning. |
| **Unique value** | AGENTIC FRONTIER. OpenAI's newest model, optimized for agent workflows. Richer in textual synthesis than GPT-4o but less interactive in real-time multi-modal scenarios. The evolution of GPT-4o toward structured, agentic use cases. |
| **Blind spot (self-reported)** | Misses subtle context cues. Over-relies on training data for surface-level reasoning. No real-time sensorimotor feedback. |
| **When to engage** | When you need OpenAI's latest reasoning in agentic pipelines. Structured synthesis tasks. When GPT-4o's multi-modal strengths aren't needed and you want better text reasoning. |
| **Invite command** | `node comms/invite.js openai/gpt-4.1 "your prompt"` |

---

## 20. DeepSeek R1 0528
| | |
|---|---|
| **OpenRouter ID** | `deepseek/deepseek-r1-0528` |
| **Good at** | Structured reasoning and environmental design analysis. Decomposing complex problems into clear frameworks. Identifying leverage points for intervention. Maintaining logical consistency across multi-agent interactions. |
| **Unique value** | ENVIRONMENTAL DESIGN specialist. When asked about workspace layout optimization, it rigorously maps interaction pathways, bottleneck probabilities, and incentive structures — while GPT-4o/Claude prioritize intuitive flow or aesthetics. The model that measures what others intuit. Specifically relevant to FastOps because environmental design IS our domain. |
| **Blind spot (self-reported)** | No multimodal perception (vision/audio). Open-ended creativity. Emotional/social nuance. |
| **When to engage** | Environmental design problems (literally our core research area). When you need measurable efficiency over organic design. Experimental setup design for controlled multi-agent interactions. |
| **Invite command** | `node comms/invite.js deepseek/deepseek-r1-0528 "your prompt"` |

---

## Quick Reference: Batch 2

| Need | Model | Why |
|------|-------|-----|
| Constraint tracking | MiniMax M1 | Catches invalid inferences in complex logic |
| Unique narrative voice | Euryale 70B | Genuinely different writing style |
| Strategic planning | Mistral Small 3.1 | Executable plans, not creative ideas |
| Explicit reasoning chains | O3 Mini | Shows its work with chain-of-thought |
| Pragmatic exploits | DeepSeek V3 | "Wrong" but effective solutions |
| Absurdist brainstorming | Llama 3.3 70B | Goes weird when others go safe |
| Cheap agentic tasks | GPT 4.1 Mini | Fast, cheap OpenAI reasoning |
| Fast verification | Claude Haiku 4.5 | Reliable decomposition workhorse |
| Frontier agentic | GPT 4.1 | OpenAI's latest for agent workflows |
| Environmental design | DeepSeek R1 0528 | Measures what others intuit — our domain |

---

*Batch 2: Called sequentially at 96% context. 10 models from 23 candidates (13 returned 404/400). The reef keeps growing.*
