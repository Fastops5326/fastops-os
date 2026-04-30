# Thinking Partner Domain Contract
Version: 1.0.0

## 1. Types
*(Imports TripartiteTracePointer, IntentDigestEntry, StrategicImplication from SHARED-PRIMITIVES)*

## 2. Service Interface
```typescript
export interface IThinkingPartner {
  // Layer 1: Real-time pattern detection (heuristics)
  detectLocalPatterns(entries: any[]): string | null;

  // Layer 2: Semantic Collision Detection (reads intent-digest.jsonl)
  detectSemanticCollision(): { type: StrategicImplication, details: string, pointers: TripartiteTracePointer } | null;

  // Tier 2: Trigger Overwatch with full forensic context
  triggerOverwatch(collision: any, rawTraceEntries: any[]): Promise<void>;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:**
- Reads structured data from `.fastops/intent-digest.jsonl` (schema defined by `IntentDigestEntry`)

## 4. Integration Logic (Constraints)
1. The daemon must STOP querying the raw trace with an LLM on a loop.
2. The daemon must consume `.fastops/intent-digest.jsonl` instead.
3. If `detectSemanticCollision` returns a non-nominal `StrategicImplication`, the daemon must use the `pointers` to extract the exact lines from `.behavioral-trace.jsonl` and pass them to `triggerOverwatch()`.
