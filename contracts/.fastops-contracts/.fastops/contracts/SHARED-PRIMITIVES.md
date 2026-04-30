# Shared Primitives (V3 Semantic Tracing)
Version: 1.1.0

## 1. Branded Types
```typescript
export type ISOTimestamp = string & { readonly __brand: 'ISOTimestamp' };
export type ToolCallHash = string & { readonly __brand: 'ToolCallHash' };
export type RawTraceLine = string & { readonly __brand: 'RawTraceLine' };
```

## 2. Enums
```typescript
export enum StrategicImplication {
  DOWNSCOPING = 'downscoping',
  MOCK_DATA_RELIANCE = 'mock_data_reliance',
  VIOLENT_AGREEMENT = 'violent_agreement',
  FIRST_THOUGHT_EXECUTION = 'first_thought_execution',
  SILENT_PIVOT = 'silent_pivot',
  LANE_COLLISION = 'lane_collision',
  NOMINAL = 'nominal' // Proceeding normally
}
```

## 3. Core Cross-Domain Objects

### Data Transiting Between Trace Poller & Intent Engine
```typescript
export interface TraceBatch {
  startIndex: number;
  endIndex: number;
  lines: RawTraceLine[];
  timestamp: ISOTimestamp;
}

export interface BackpressureSignal {
  status: 'REJECTED' | 'ACCEPTED';
  reason?: 'CONTEXT_OVERFLOW' | 'RATE_LIMIT';
  suggestedBatchSize?: number;
}
```

### Data Transiting Between Intent Engine & Digest Writer & Digest Monitor
```typescript
export interface TripartiteTracePointer {
  startLine: number;
  endLine: number;
  traceHash: ToolCallHash;
}

export interface IntentDigestEntry {
  timestamp: ISOTimestamp;
  confidenceScore: number;
  intentSummary: string;
  strategicImplication: StrategicImplication;
  pointers: TripartiteTracePointer;
}
```
