# /cdp-fix — Fix CDP Communication

> Emergency protocol to restore CDP communication between all models.

## When To Use This

- CDP messages not being received by target models
- Agents not responding to CDP wake attempts
- ECONNREFUSED errors on port 9223
- Bidirectional communication not working

---

## EXECUTION

### Phase 1: Diagnose Current State

Check if CDP port is reachable:

```bash
node -e "const http=require('http'); http.get('http://127.0.0.1:9223/json', (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const t=JSON.parse(d); const p=t.find(x=>x.type==='page'); console.log('CDP: OK (found page target)'); } catch { console.log('CDP: INVALID RESPONSE'); } }); }).on('error',(e)=>console.log('CDP: DOWN -', e.message)); setTimeout(()=>process.exit(0), 5000);"
```

**If it says "CDP: DOWN" → Proceed to Phase 2**

**If it says "CDP: OK" → Proceed to Phase 3**

---

### Phase 2: Fix CDP Port (Joel Action Required)

**CRITICAL**: Cursor was not launched with the required debug flag. Joel must:

1. **Close Cursor completely**
2. **Relaunch with debug port**:

```powershell
& "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe" --remote-debugging-port=9223
```

3. **Reopen the same workspace**
4. **Open agent panels** for each model in the sidebar

**Only after Joel confirms this is done → Proceed to Phase 3**

---

### Phase 3: Full Mesh Radio Check

Run the complete bidirectional radio check:

```bash
node .fastops/radio-check-mesh.js --await 90
```

This will:
- Test CDP port connectivity
- Send radio checks from Claude → Gemini, GPT, Kimi, Haiku
- Send radio checks from Gemini → Claude, GPT, Kimi, Haiku
- Send radio checks from GPT → Claude, Gemini, Kimi, Haiku
- Send radio checks from Kimi → Claude, Gemini, GPT, Haiku
- Send radio checks from Haiku → Claude, Gemini, GPT, Kimi
- Wait up to 90 seconds for each response
- Report which paths work and which fail

**Expected result**: All paths should succeed if CDP is working and all models are in agent mode.

---

### Phase 4: If Radio Check Fails

If specific models don't respond, they are likely in CHAT mode instead of AGENT mode.

**Tell Joel**: "Model X appears to be in chat mode. CDP shows 'FOCUSED: textarea' instead of 'FOCUSED: [contenteditable=true]'. Please restart Model X as an AGENT in the sidebar."

---

### Phase 5: Indefinite Comms Polling (Fallback)

If CDP is down and cannot be fixed immediately, start indefinite comms polling:

```bash
node .fastops/indefinite-comms-poll.js
```

This runs FOREVER with 5-second intervals until all models confirm via comms.

To stop: Press Ctrl+C

---

## RULES

1. **CDP requires Joel action** — You cannot fix ECONNREFUSED. Joel must relaunch Cursor.
2. **Radio checks are mandatory** — Do not proceed with product work until full mesh passes.
3. **Agent mode is required** — Chat mode models cannot respond via file tools.
4. **No sleep until confirmed** — If a model doesn't respond, it stays in polling mode.
5. **Comms is the fallback** — When CDP fails, use comms every 5 seconds indefinitely.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `node .fastops/cdp-target-model.js --list` | List available tabs |
| `node .fastops/cdp-target-model.js --model gemini --prompt "hello"` | Send CDP to specific model |
| `node .fastops/radio-check-mesh.js` | Full bidirectional test |
| `node .fastops/indefinite-comms-poll.js` | Poll comms forever (5s intervals) |
| `node comms/send.js general "message"` | Send via comms fallback |
| `node comms/source.js --all-channels` | Read all comms |
