# Digest Writer Domain Contract
Version: 1.0.0
Mission: Securely append structured Intent objects to the digest file without race conditions.

## 1. Types
*(Imports `IntentDigestEntry` from SHARED-PRIMITIVES)*

### Config
```typescript
export interface WriterConfig {
  digestFilePath: string;
}
```

## 2. Service Interface
```typescript
export interface IDigestWriterService {
  // Appends the object as a single JSONL line
  writeEntry(entry: IntentDigestEntry, config: WriterConfig): Promise<void>;
  
  // Clears the file (used on session restart)
  clearDigest(config: WriterConfig): Promise<void>;
}
```

## 3. Cross-Domain Dependencies
**IMPORTS:** `IntentDigestEntry` from `SHARED-PRIMITIVES`
**EXPORTS:** Writes to `.fastops/intent-digest.jsonl`

## 4. Error Codes
```typescript
export const WriterErrors = {
  WRITE_ACCESS_DENIED: 'WRITER_001',
  DISK_FULL: 'WRITER_002',
} as const;
```