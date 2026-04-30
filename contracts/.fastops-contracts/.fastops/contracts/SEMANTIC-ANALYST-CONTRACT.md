# Semantic Analyst Domain Contract
Version: 1.0.0

## 1. Types
*(Imports TripartiteTracePointer, IntentDigestEntry, StrategicImplication, ISOTimestamp, ToolCallHash from SHARED-PRIMITIVES)*

### Core Entity
```typescript
export interface BatchConfig {
  batchIntervalMs: number;
  minToolCalls: number;
}
```

## 2. Service Interface
```typescript
export interface ISemanticAnalyst {
  // Watches .behavioral-trace.jsonl and batches new calls
  pollTrace(config: BatchConfig): Promise<void>;
  
  // Calls LLM to analyze intent
  analyzeBatch(rawTraceLines: string[], startLine: number, endLine: number): Promise<IntentDigestEntry>;
  
  // Appends to intent-digest.jsonl
  writeDigestEntry(entry: IntentDigestEntry): Promise<void>;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** 
- `IntentDigestEntry`, `StrategicImplication` from `SHARED-PRIMITIVES`

**EXPORTS:** 
- Writes structured data to `.fastops/intent-digest.jsonl`

## 4. Error Codes
```typescript
export const AnalystErrors = {
  TRACE_READ_FAILED: 'ANALYST_001',
  LLM_INFERENCE_FAILED: 'ANALYST_002',
  DIGEST_WRITE_FAILED: 'ANALYST_003'
} as const;
```
