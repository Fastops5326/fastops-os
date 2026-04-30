# Phase 2: Multi-Tenant Cloud Migration Plan

**Goal:** Transform FastOps OS from a single-tenant local engine to a globally accessible, multi-tenant SaaS platform hosted on AWS, supporting multiple discrete organizations and users.

---

## 1. Storage Abstraction (The `fs` Purge)
Currently, state is managed via direct filesystem operations (`fs.readFileSync`, `fs.writeFileSync`) in files like:
- `src/engine/core/state-store.ts`
- `src/engine/overwatch/knowledge-store.ts`
- `src/engine/persistence/compaction-artifact-store.ts`
- `.jsonl` comms logs

**Action:** 
Create a unified `StorageProvider` interface.
```typescript
interface StorageProvider {
  get(tenantId: string, key: string): Promise<any>;
  set(tenantId: string, key: string, value: any): Promise<void>;
  append(tenantId: string, streamKey: string, value: any): Promise<void>;
  list(tenantId: string, prefix: string): Promise<any[]>;
}
```
*We will implement a `LocalFileStorage` adapter for local dev, and an `AwsDynamoStorage` adapter for production.*

## 2. Authentication & Tenancy Isolation
The engine currently assumes one global state. We must introduce **Tenant IDs** (representing an organization/user) to all API calls, WebSocket connections, and data structures.

**Actions:**
1. **Auth Middleware:** Integrate AWS Cognito (or Clerk/Auth0). Add `verifyToken` middleware to `src/server/api.ts` and WebSocket upgrade requests.
2. **Tenant Context:** Inject `tenantId` into the `FastOpsEngine` initialization per request/connection.
3. **Data Partitioning:** Every record in the database (sessions, contracts, comms) must have a `tenantId` partition key. 
4. **Bring Your Own Key (BYOK):** Implement AWS Secrets Manager to store users' Anthropic/OpenAI API keys securely, keyed by `tenantId`.

## 3. Database Layer (DynamoDB)
To survive server restarts and scale horizontally, memory must move to a managed database.

**Actions:**
- **Table 1: `FastOps_Sessions`** (PK: `tenantId`, SK: `sessionId`). Stores token counts, metadata, and the latest context window.
- **Table 2: `FastOps_Comms`** (PK: `tenantId#channel`, SK: `timestamp`). Replaces the `.jsonl` files for the chat history.
- **Table 3: `FastOps_State`** (PK: `tenantId`). Replaces `state.json` (Contracts, Missions, Todos).
- **Table 4: `FastOps_Knowledge`** (PK: `tenantId`, SK: `articleId`). Replaces the Overwatch knowledge catalog.

## 4. Real-Time Distributed Pub/Sub (Redis)
Currently, `WebSocket` events are broadcasted locally in node memory. If AWS spins up 3 containers to handle load, a message generated on Container A will not reach a user's browser connected to Container B.

**Action:**
Introduce **Amazon ElastiCache (Redis)**.
- When an agent replies, the engine publishes the message to a Redis channel: `PUBLISH tenant_123_comms {msg}`.
- All WebSocket servers subscribe to Redis. When a message hits Redis, the specific WebSocket server holding the user's connection pushes it to their browser.

## 5. AWS Deployment Architecture

### The Frontend (`fastops-ui`)
- **Hosting:** AWS Amplify (or Vercel).
- **Benefits:** Global CDN, instant loading, automatically handles custom domains and SSL.

### The Backend (`fastops-os`)
- **Compute:** AWS ECS Fargate (Serverless Containers).
- **Routing:** AWS Application Load Balancer (ALB) to route traffic and maintain sticky WebSocket connections.
- **Database:** Amazon DynamoDB (On-Demand capacity).
- **Cache/PubSub:** Amazon ElastiCache (Redis).
- **Secrets:** AWS Secrets Manager (for user BYOK API keys).

---

## Migration Steps (The Execution Order)

1. **Step 1:** Build the `StorageProvider` interface and refactor all `fs.*` calls to use `LocalFileStorage`. (Ensures no regression in current workflow).
2. **Step 2:** Introduce the `tenantId` parameter to all internal Engine methods and API routes. Hardcode to `"local-dev"` for now.
3. **Step 3:** Implement the AWS DynamoDB storage adapter.
4. **Step 4:** Integrate the Auth Middleware and BYOK secret manager.
5. **Step 5:** Containerize and deploy to AWS Fargate + Redis.
6. **Step 6:** Onboard the first 5 beta users.