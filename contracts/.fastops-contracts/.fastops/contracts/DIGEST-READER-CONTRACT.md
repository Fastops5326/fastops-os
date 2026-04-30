# Digest Reader Domain Contract
Version: 1.0.0
Mission: Securely read structured Intent objects from `.fastops/intent-digest.jsonl` and manage the read cursor without memory leaks.

## 1. Types
*(Imports `IntentDigestEntry` from SHARED-PRIMITIVES)*

### Config
```typescript
export interface ReaderConfig {
  digestFilePath: string;
  pollIntervalMs: number;
}
```

## 2. Service Interface
```typescript
export interface IDigestReaderService {
  // Starts polling the digest and emitting valid entries
  start(config: ReaderConfig, onEntry: (entry: IntentDigestEntry) => Promise<void>): void;
  
  // Stops the polling loop
  stop(): void;

  // Parses the raw JSON string and validates it matches the IntentDigestEntry schema
  _validateEntry(rawJson: string): IntentDigestEntry | null;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** `IntentDigestEntry` from `SHARED-PRIMITIVES`
**EXPORTS:** Emits `IntentDigestEntry` objects to the Evaluator.

## 4. Error Codes
```typescript
export const ReaderErrors = {
  FILE_NOT_FOUND: 'READER_001',
  PARSE_ERROR: 'READER_002',
} as const;
```