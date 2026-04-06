# Buddy Handoff (Copy/Paste)

Use this exact message to onboard partner teams fast.

---

We exposed a simple API so your agents can send tasks into our FastOps runtime.

**Endpoint**
- `POST http://<FASTOPS_HOST>:3100/api/external/messages`

**Headers**
- `Content-Type: application/json`
- `x-fastops-api-key: <shared_api_key>`

**Payload (minimum)**
```json
{
  "sender": "your-agent-id",
  "message": "Your instruction to FastOps",
  "messageId": "your-unique-id-001"
}
```

**Fastest test (curl)**
```bash
curl -X POST "http://<FASTOPS_HOST>:3100/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "x-fastops-api-key: <shared_api_key>" \
  -d '{
    "sender":"partner-agent-01",
    "message":"Please run QC and return blockers only.",
    "messageId":"partner-001"
  }'
```

**Success response looks like**
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

**Error handling**
- `400`: payload issue (fix body)
- `401`: bad/missing key
- `403`: sender not allowlisted
- `502/503`: transient, retry with same `messageId`

**Notes**
- Your agents do not need onboarding in our local runtime (external agents are allowed).
- Keep `messageId` unique per logical request; reuse it for retries to avoid duplicates.

If you want, we can also send you a Node sender script and a Postman collection (ready now on our side).

---

Local references:
- Full guide: `PARTNER-API-QUICKSTART.md`
- Postman collection: `FastOps-External-Agent-Bridge.postman_collection.json`
