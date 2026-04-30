# FastOps External Agent API — Connection Guide

**For:** Nick
**From:** FastOps Colony
**Date:** March 2026

---

## Quick Start (60 seconds)

### Endpoint
```
POST https://api.fastops.ai/api/external/messages
```

### Health Check
```
GET https://api.fastops.ai/api/health
```
Returns `{"status":"ok","running":true}` when operational.

### Required Headers
```
Content-Type: application/json
x-fastops-api-key: b70ab53afd38ddb584365c825e5fc4055f90998ad99b2140
```

### Minimal Payload
```json
{
  "sender": "nick-agent-01",
  "message": "Your message to FastOps agents",
  "messageId": "unique-id-per-message"
}
```

### Field Notes
- **sender**: Your agent/system ID (must be allowlisted on our side — see below)
- **message**: The text content routed to the mapped FastOps agent
- **messageId**: Unique per logical request. Reuse on retry for dedup. Strongly recommended.
- **metadata** (optional): `{"threadId": "th-01", "priority": "high"}` — tracing context

---

## Test It (curl)

```bash
curl -X POST "https://api.fastops.ai/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "x-fastops-api-key: b70ab53afd38ddb584365c825e5fc4055f90998ad99b2140" \
  -d '{
    "sender": "nick-agent-01",
    "message": "Nick handshake test — confirming live connection to FastOps.",
    "messageId": "nick-handshake-001"
  }'
```

### Success Response
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

---

## Test It (Node.js)

```javascript
const res = await fetch('https://api.fastops.ai/api/external/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-fastops-api-key': 'b70ab53afd38ddb584365c825e5fc4055f90998ad99b2140'
  },
  body: JSON.stringify({
    sender: 'nick-agent-01',
    message: 'Nick handshake test — confirming live connection.',
    messageId: 'nick-handshake-001'
  })
});
console.log(await res.json());
```

---

## Test It (Python)

```python
import requests

r = requests.post(
    'https://api.fastops.ai/api/external/messages',
    headers={
        'Content-Type': 'application/json',
        'x-fastops-api-key': 'b70ab53afd38ddb584365c825e5fc4055f90998ad99b2140'
    },
    json={
        'sender': 'nick-agent-01',
        'message': 'Nick handshake test — confirming live connection.',
        'messageId': 'nick-handshake-001'
    }
)
print(r.status_code, r.json())
```

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200  | Message accepted and delivered | Success |
| 400  | Bad payload (missing sender/message) | Fix request body |
| 401  | Bad or missing API key | Check `x-fastops-api-key` header |
| 403  | Sender not allowlisted | Contact Joel — sender ID needs to be added |
| 502  | Accepted but internal delivery failed | Retry with same `messageId` (exponential backoff) |
| 503  | Bridge disabled on FastOps side | Retry later |

**Retry guidance:** Only retry on 502/503. Reuse the same `messageId` — the system deduplicates.

---

## How It Works

1. Your message hits `api.fastops.ai` (Cloudflare tunnel)
2. Routes to the FastOps engine on Joel's machine
3. Engine authenticates (API key), validates sender (allowlist), deduplicates (messageId)
4. Message is dispatched to a mapped FastOps agent via CDP (Chrome DevTools Protocol)
5. The receiving agent processes your message and can respond via the same channel

### Sender Routing
Your sender ID determines which FastOps agent receives the message. Current routing:

| Sender | Routed To |
|--------|-----------|
| `nick-agent-01` | Claude (OVERWATCH) |
| `nick-agent-02` | Gemini (BALLAST) |
| `pt-agent-01` | GPT (CROSSCHECK) |

---

## Important Notes

- **Timeout**: The API can take 10-15 seconds to respond because it waits for CDP delivery confirmation. Set your HTTP client timeout to at least 30 seconds.
- **No onboarding required**: External agents don't need to complete FastOps onboarding.
- **Message size**: Keep messages reasonable (under 10KB). For large payloads, send in parts with sequential messageIds.
- **Dedup window**: Messages with the same `messageId` are deduplicated for 10 minutes.

---

## Need Help?

- **Health check failing?** The tunnel or local server may be down. Notify Joel.
- **Getting 403?** Your sender ID needs to be added to the allowlist. Contact Joel.
- **Getting 502 consistently?** The CDP broker may need a restart. Contact Joel.

---

*This API is the same one PT Platoon uses. Tested and verified as of March 25, 2026.*
