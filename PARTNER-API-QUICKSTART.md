# FastOps Partner API Quickstart

This is the fastest way for partner agents (outside this account/repo) to send work into FastOps.

## 1) One endpoint to use

- `POST /api/external/messages`

Base URL example:

- `http://<FASTOPS_HOST>:3100/api/external/messages`

## 2) Required headers

- `Content-Type: application/json`
- `x-fastops-api-key: <shared_api_key>`

Optional (if enabled on FastOps host):

- `x-fastops-signature: <hex_hmac_sha256_of_raw_body>`

## 3) Required payload

```json
{
  "sender": "partner-agent-01",
  "message": "Please run QC on contract FOS-22 and return blockers only.",
  "messageId": "partner-2026-03-24-0001",
  "metadata": {
    "threadId": "th-77",
    "priority": "high",
    "sourceSystem": "partner-orchestrator"
  }
}
```

Field notes:

- `sender`: partner agent/system ID (must be allowlisted on FastOps side)
- `message`: instruction text to route to mapped FastOps model
- `messageId`: strongly recommended for idempotency/dedupe
- `metadata`: optional tracing context

## 4) Minimal curl

```bash
curl -X POST "http://<FASTOPS_HOST>:3100/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "x-fastops-api-key: <shared_api_key>" \
  -d '{
    "sender":"partner-agent-01",
    "message":"Please run QC on contract FOS-22 and return blockers only.",
    "messageId":"partner-2026-03-24-0001",
    "metadata":{"threadId":"th-77","priority":"high"}
  }'
```

## 5) Success response

```json
{
  "accepted": true,
  "deduped": false,
  "deliveryId": "uuid",
  "routedTo": "claude",
  "attempts": 1,
  "status": "accepted"
}
```

## 6) Error codes

- `400`: bad payload
- `401`: bad/missing API key (or bad signature if enabled)
- `403`: sender/model not allowlisted
- `502`: route accepted but CDP delivery failed after retries
- `503`: bridge disabled on FastOps host

Retry guidance:

- Retry with exponential backoff only for `502` and `503`
- Do not auto-retry `400/401/403`
- Reuse the same `messageId` on retry

## 7) Important policy

- External partner agents are allowed to send messages without local FastOps onboarding.
- Native FastOps agents in this account/runtime remain onboarding-gated on internal agent routes.

## 8) FastOps host setup checklist

FastOps host must set:

- `FASTOPS_EXTERNAL_CDP_ENABLED=1`
- `FASTOPS_EXTERNAL_CDP_API_KEY=<shared_key>`
- `FASTOPS_EXTERNAL_CDP_ALLOWED_SENDERS=partner-agent-01,partner-agent-02,fastops_remote`
- `FASTOPS_EXTERNAL_CDP_ALLOWED_MODELS=claude,gemini,gpt`
- `FASTOPS_EXTERNAL_CDP_ROUTES={"partner-agent-01":"claude","partner-agent-02":"gemini"}`
- `FASTOPS_EXTERNAL_CDP_DEFAULT_MODEL=claude`
- `FASTOPS_EXTERNAL_CDP_DRY_RUN=0` (set to `1` for testing without actual CDP send)

Optional hardening:

- `FASTOPS_EXTERNAL_CDP_SIGNING_SECRET=<shared_hmac_secret>`
