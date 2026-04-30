# Intent Engine Domain Contract
Version: 1.0.0
Mission: Accept raw tool call batches, interface with the LLM API, and return structured Semantic Intents. Does NOT interact with the file system.

## 1. Types
*(Imports `TraceBatch`, `IntentDigestEntry`, `StrategicImplication`, `TripartiteTracePointer` from SHARED-PRIMITIVES)*

### Config
```typescript
export interface EngineConfig {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
}
```

## 2. Service Interface
```typescript
export interface IIntentEngineService {
  // Core inference function. Must return a BackpressureSignal if it fails.
  analyzeBatch(batch: TraceBatch, config: EngineConfig): Promise<IntentDigestEntry | BackpressureSignal>;

  // Utility: Creates the cryptographic pointer hash
  _generateTraceHash(lines: string[]): string;

  // Utility: Parses LLM response into the strict enum
  _parseStrategicImplication(llmOutput: string): StrategicImplication;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** `TraceBatch`, `IntentDigestEntry` from `SHARED-PRIMITIVES`
**EXPORTS:** Returns `IntentDigestEntry` to orchestrator.

## 4. Constraints
- The engine MUST NOT read or write to disk. It only accepts `TraceBatch` objects and returns `IntentDigestEntry` objects.
- If the LLM returns an invalid Strategic Implication, it must default to `StrategicImplication.NOMINAL`.

## 5. Error Codes
```typescript
export const EngineErrors = {
  API_TIMEOUT: 'ENGINE_001',
  MALFORMED_JSON_RESPONSE: 'ENGINE_002',
} as const;
```