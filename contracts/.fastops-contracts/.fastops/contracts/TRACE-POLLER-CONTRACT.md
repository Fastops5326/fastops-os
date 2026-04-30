# Trace Poller Domain Contract
Version: 1.0.0
Mission: Efficiently read `.behavioral-trace.jsonl`, chunk it, and pass batches to the Intent Engine without memory leaks.

## 1. Types
*(Imports `TraceBatch`, `RawTraceLine`, `ISOTimestamp` from SHARED-PRIMITIVES)*

### Configuration
```typescript
export interface PollerConfig {
  filePath: string;
  batchSizeLimit: number; // e.g. Max 50 lines per batch
  pollIntervalMs: number;
}
```

## 2. Service Interface
```typescript
export interface ITracePollerService {
  // Starts the polling loop
  start(config: PollerConfig, onBatchReady: (batch: TraceBatch) => Promise<BackpressureSignal>): void;
  
  // Stops the polling loop
  stop(): void;

  // Handles dynamic resizing of the next batch based on downstream signals
  _applyBackpressure(signal: BackpressureSignal): void;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** `TraceBatch` from `SHARED-PRIMITIVES`
**EXPORTS:** Emits `TraceBatch` events to the orchestrator/Intent Engine.

## 4. Error Codes
```typescript
export const PollerErrors = {
  FILE_NOT_FOUND: 'POLLER_001',
  READ_STREAM_FAILED: 'POLLER_002',
} as const;
```