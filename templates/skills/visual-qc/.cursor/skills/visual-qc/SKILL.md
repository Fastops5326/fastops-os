---
name: visual-qc
description: Deterministic Visual Quality Control (QC) gate. Use this skill whenever visual verification of UI, PPTX, or PDF artifacts is required. This enforces OS-level binary gates to prevent hallucinated visual QA.
---

# Deterministic Visual QC Gate

This skill enforces a structural, cryptographic, and OS-level gate for visual verification. Agents CANNOT bypass this process. The final artifact will physically fail to deploy or move to the user's directory unless these binary gates are cleared.

## The 3 Deterministic Gates

### 1. The Token Truncation Hard Gate (Binary: Pass/Fail)
**What it does:** Prevents the artifact from passing if the underlying LLM/City Model ran out of tokens and truncated its response.
**The Gate:** The generation script must output an evaluation log (`eval-log.json`). You must run the gate script to verify it.
```bash
node .fastops/qc-gate.js verify-tokens .fastops/staging/eval-log.json
```
*If this returns Exit Code 1, you MUST fix the `max_tokens` limit and regenerate.*

### 2. The Extraction Checkpoint (Binary: Exists/Missing)
**What it does:** Proves that the binary artifact (e.g., `.pptx`) can actually be opened and contains images.
**The Gate:** You must extract the PPTX/PDF into `.PNG` files using a local script or PowerShell COM automation.
*If the `.PNG` files do not physically exist in the directory, you cannot proceed to Step 3.*

### 3. The Cryptographic Sign-Off Lock (Binary: Hash Match)
**What it does:** Physically prevents the artifact from being delivered to the user until you have explicitly provided visual verification comments, generating a SHA-256 signature file.
**The Gate:** You must view the extracted `.PNG` files using your `Read` tool. Then, you must run the sign-off gate to physically move the file to the user's `Downloads` folder.
```bash
node .fastops/qc-gate.js signoff .fastops/staging/WarriorPath_Final.pptx "I visually verified Slide 1 and 2. The navbar is static at the bottom. The text is not truncated. No overlapping elements."
```
*If this returns Exit Code 1 (e.g., your comment is too short or missing), the file will NOT be moved, and the user will not see it.*

## Workflow

1. Generate the artifact into `.fastops/staging/`.
2. Generate the API logs into `.fastops/staging/eval-log.json`.
3. Run `node .fastops/qc-gate.js verify-tokens .fastops/staging/eval-log.json`.
4. Extract the artifact to `.PNG` images.
5. Use the `Read` tool to ingest and visually inspect the `.PNG` images.
6. Run `node .fastops/qc-gate.js signoff <path_to_artifact> "<detailed_visual_observations>"`.
7. Present the final success message to the user, confirming the SHA-256 signature has been generated.
