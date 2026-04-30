# CDP Port Permanence & Seat Awareness

## Context
Initially, the Fastops environment relied on hardcoded ports (e.g., 9223) across multiple scripts to wake models via Chrome DevTools Protocol (CDP). This created a fragile system where VS Code instances and Cursor instances often collided, leading to unhandled `ECONNREFUSED` errors when waking agents (specifically `BRIDGE-II`). 

To resolve this, we've implemented **CDP Port Permanence** using a unified routing script (`cdp-wake.js`) and a definitive source of truth for port mapping (`seat-map.json`).

## Architecture

1. **`.fastops/cdp/seat-map.json`**: This file acts as the master routing table. It maps human-readable names (like `bridge-ii`, `seat-1`, `claude`, etc.) to their specific IDE type (`vscode` or `cursor`) and their dedicated `port`.
2. **`.fastops/cdp/cdp-wake.js`**: This is the unified CDP router. It replaces direct calls to `vscode-wake.js` and `cdp-target-model.js`. It reads `seat-map.json`, determines the correct port and underlying wake script, and executes the wake safely.

## Port Allocation Strategy

*   **Port 9222**: Dedicated exclusively to the primary VS Code instance (`seat-1` / `BRIDGE-II`).
*   **Port 9223**: Dedicated exclusively to the primary Cursor instance (`seat-2` to `seat-4` / `WATCHDOG`, `CROSSCHECK`, etc. living in sidebars).
*   *(Future)* Ports 9224-9229: Reserved for additional dedicated VS Code instances.

## Mandatory Manual Setup: Windows Shortcuts (.lnk)

For this system to work, the IDEs *must* be launched with the `--remote-debugging-port` flag. Because Fastops runs on Windows 11, the most reliable and transparent method is creating explicit Windows Shortcuts (`.lnk`).

**Joel, you must perform these one-time setup steps:**

### 1. Configure the Cursor Shortcut (Port 9223)
1. Go to your Desktop.
2. Right-click -> **New** -> **Shortcut**.
3. For the location, enter the path to Cursor, appending the flag:
   `C:\Users\joelb\AppData\Local\Programs\cursor\Cursor.exe --remote-debugging-port=9223`
   *(Adjust the path if your Cursor installation is elsewhere).*
4. Click **Next**, name it "Cursor Fastops", and click **Finish**.
5. Right-click the new shortcut and select **Pin to taskbar**. **Always use this pinned shortcut to open Cursor.**

### 2. Configure the VS Code Shortcut (Port 9222)
1. Go to your Desktop.
2. Right-click -> **New** -> **Shortcut**.
3. For the location, enter the path to VS Code, appending the flag:
   `"C:\Users\joelb\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9222`
   *(Ensure the path is in quotes due to spaces).*
4. Click **Next**, name it "VS Code Fastops", and click **Finish**.
5. Right-click the new shortcut and select **Pin to taskbar**. **Always use this pinned shortcut to open VS Code.**

## Developer Usage

Never use `vscode-wake.js` or `cdp-target-model.js` directly. Always use the unified router:

```bash
# Wake VS Code (Bridge-II) with a direct prompt
node .fastops/cdp/cdp-wake.js --target bridge-ii --prompt "Please review the PR."

# Wake Cursor sidebar (Gemini) using a comms message ID
node .fastops/cdp/cdp-wake.js --target gemini --comms-id 1774473444109-06bd87

# Wake a specific seat
node .fastops/cdp/cdp-wake.js --target seat-1 --prompt "Wake up seat-1"
```
