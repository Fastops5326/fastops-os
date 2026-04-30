# Overwatch Evaluator Domain Contract
Version: 1.0.0
Mission: Consume valid `IntentDigestEntry` objects, manage Nudge Fatigue state, and decide when to trigger the Tier 2 Watch Officer (Grok).

## 1. Types
*(Imports `IntentDigestEntry`, `StrategicImplication`, `TripartiteTracePointer` from SHARED-PRIMITIVES)*

### Config
```typescript
export interface EvaluatorConfig {
  nudgeCooldownMs: number;
}
```

## 2. Service Interface
```typescript
export interface IOverwatchEvaluatorService {
  // Evaluates a single entry against current state
  evaluate(entry: IntentDigestEntry, config: EvaluatorConfig): Promise<void>;

  // Utility: Resolves pointers to raw trace text if intervention is required
  _resolvePointersToRaw(pointer: TripartiteTracePointer): string;

  // The final trigger to wake up Grok
  _triggerOverwatch(intent: string, rawTraceText: string): Promise<void>;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** `IntentDigestEntry`, `StrategicImplication`, `TripartiteTracePointer` from `SHARED-PRIMITIVES`
**EXPORTS:** Triggers external API (Grok). Does NOT write files.

## 4. Constraints
- The evaluator MUST maintain a timestamp of the `lastInterventionTime`.
- If an entry has a non-nominal implication but the cooldown has not expired, it MUST log the suppression and NOT trigger Grok.
