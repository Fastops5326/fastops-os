import { createHmac, randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

interface BridgeConfig {
  enabled: boolean;
  apiKey?: string;
  signingSecret?: string;
  cdpScriptPath: string;
  modelRoutes: Record<string, string>;
  defaultModel?: string;
  allowedSenders: Set<string>;
  allowedModels: Set<string>;
  broadcastModels: string[];
  timeoutMs: number;
  maxAttempts: number;
  dedupeTtlMs: number;
  dryRun: boolean;
  auditPath: string;
}

export interface ExternalMessageInput {
  sender: string;
  message: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

export interface BridgeHeaders {
  apiKey?: string;
  signature?: string;
}

export interface ExternalDeliveryResult {
  accepted: boolean;
  deduped: boolean;
  deliveryId: string;
  routedTo: string;
  broadcastedTo?: string[];
  attempts: number;
  status: 'accepted' | 'failed';
  error?: string;
}

class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: 'disabled' | 'unauthorized' | 'forbidden' | 'bad_request' | 'delivery_failed',
  ) {
    super(message);
  }
}

export class ExternalCdpBridge {
  private readonly config: BridgeConfig;
  private readonly dedupe = new Map<string, number>();

  constructor(private readonly workingDirectory: string) {
    this.config = this.loadConfig();
  }

  private loadConfig(): BridgeConfig {
    const defaultScriptPath = join(
      this.workingDirectory,
      '..',
      'Fastops development process',
      '.fastops',
      'cdp-target-model.js',
    );
    const routes = this.parseJsonMap(process.env.FASTOPS_EXTERNAL_CDP_ROUTES);
    const allowedSenders = this.parseCsvSet(process.env.FASTOPS_EXTERNAL_CDP_ALLOWED_SENDERS);
    const allowedModels = this.parseCsvSet(process.env.FASTOPS_EXTERNAL_CDP_ALLOWED_MODELS);

    const auditPath = join(this.workingDirectory, '.fastops-engine', 'external-cdp-bridge.jsonl');
    mkdirSync(dirname(auditPath), { recursive: true });

    const broadcastRaw = process.env.FASTOPS_EXTERNAL_CDP_BROADCAST_MODELS;
    const broadcastModels = broadcastRaw
      ? broadcastRaw.split(',').map((m) => m.trim()).filter(Boolean)
      : [];

    return {
      enabled: process.env.FASTOPS_EXTERNAL_CDP_ENABLED === '1',
      apiKey: process.env.FASTOPS_EXTERNAL_CDP_API_KEY,
      signingSecret: process.env.FASTOPS_EXTERNAL_CDP_SIGNING_SECRET,
      cdpScriptPath: process.env.FASTOPS_EXTERNAL_CDP_SCRIPT || defaultScriptPath,
      modelRoutes: routes,
      defaultModel: process.env.FASTOPS_EXTERNAL_CDP_DEFAULT_MODEL,
      allowedSenders,
      allowedModels,
      broadcastModels,
      timeoutMs: this.parseInt(process.env.FASTOPS_EXTERNAL_CDP_TIMEOUT_MS, 30000),
      maxAttempts: this.parseInt(process.env.FASTOPS_EXTERNAL_CDP_MAX_ATTEMPTS, 2),
      dedupeTtlMs: this.parseInt(process.env.FASTOPS_EXTERNAL_CDP_DEDUPE_TTL_MS, 10 * 60 * 1000),
      dryRun: process.env.FASTOPS_EXTERNAL_CDP_DRY_RUN === '1',
      auditPath,
    };
  }

  private parseInt(value: string | undefined, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  private parseCsvSet(value: string | undefined): Set<string> {
    if (!value) return new Set<string>();
    return new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );
  }

  private parseJsonMap(value: string | undefined): Record<string, string> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k && typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      return out;
    } catch {
      return {};
    }
  }

  private logAudit(entry: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    });
    appendFileSync(this.config.auditPath, `${line}\n`);
  }

  /** Persist full inbound message content before CDP dispatch. */
  private persistMessage(input: ExternalMessageInput, deliveryId: string, routedTo: string): void {
    const inboxPath = join(dirname(this.config.auditPath), 'inbound-messages.jsonl');
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      deliveryId,
      sender: input.sender,
      messageId: input.messageId || null,
      routedTo,
      message: input.message,
      metadata: input.metadata || null,
    });
    appendFileSync(inboxPath, `${entry}\n`);
  }

  private verifySignature(rawBody: string | undefined, signature: string | undefined): boolean {
    if (!this.config.signingSecret) return true;
    if (!rawBody || !signature) return false;
    const expected = createHmac('sha256', this.config.signingSecret).update(rawBody).digest('hex');
    return signature === expected;
  }

  private clearExpiredDedupe(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.dedupe) {
      if (expiresAt <= now) this.dedupe.delete(id);
    }
  }

  private resolveTargetModel(sender: string): string {
    const routed = this.config.modelRoutes[sender] || this.config.defaultModel;
    if (!routed) {
      throw new BridgeError(`No route for sender "${sender}" and no default model configured`, 'bad_request');
    }
    if (this.config.allowedModels.size > 0 && !this.config.allowedModels.has(routed)) {
      throw new BridgeError(`Routed model "${routed}" is not in allowed model list`, 'forbidden');
    }
    return routed;
  }

  private async dispatchViaCdp(model: string, prompt: string): Promise<void> {
    if (this.config.dryRun) return;
    if (!existsSync(this.config.cdpScriptPath)) {
      throw new Error(`CDP script not found: ${this.config.cdpScriptPath}`);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'node',
        [this.config.cdpScriptPath, '--model', model, '--legacy-full-prompt', '--prompt', prompt],
        {
          cwd: this.workingDirectory,
          windowsHide: true,
          stdio: 'pipe',
        },
      );

      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`CDP timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `CDP exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async deliver(input: ExternalMessageInput, headers: BridgeHeaders, rawBody?: string): Promise<ExternalDeliveryResult> {
    if (!this.config.enabled) {
      throw new BridgeError('External CDP bridge is disabled', 'disabled');
    }
    if (!input.sender || !input.message) {
      throw new BridgeError('sender and message are required', 'bad_request');
    }
    if (this.config.apiKey && headers.apiKey !== this.config.apiKey) {
      throw new BridgeError('Invalid API key', 'unauthorized');
    }
    if (!this.verifySignature(rawBody, headers.signature)) {
      throw new BridgeError('Signature verification failed', 'unauthorized');
    }
    if (this.config.allowedSenders.size > 0 && !this.config.allowedSenders.has(input.sender)) {
      throw new BridgeError(`Sender "${input.sender}" is not allowlisted`, 'forbidden');
    }

    this.clearExpiredDedupe();
    const dedupeKey = input.messageId?.trim();
    if (dedupeKey && this.dedupe.has(dedupeKey)) {
      const dedupedResult: ExternalDeliveryResult = {
        accepted: true,
        deduped: true,
        deliveryId: randomUUID(),
        routedTo: this.resolveTargetModel(input.sender),
        attempts: 0,
        status: 'accepted',
      };
      this.logAudit({
        event: 'external.message.deduped',
        sender: input.sender,
        messageId: dedupeKey,
        routedTo: dedupedResult.routedTo,
      });
      return dedupedResult;
    }

    const primaryModel = this.resolveTargetModel(input.sender);
    const deliveryId = randomUUID();

    // Persist full message content before CDP dispatch — survives delivery failures
    this.persistMessage(input, deliveryId, primaryModel);

    const prompt = [
      `[EXTERNAL-AGENT-MESSAGE]`,
      `sender=${input.sender}`,
      input.messageId ? `messageId=${input.messageId}` : undefined,
      input.metadata ? `metadata=${JSON.stringify(input.metadata)}` : undefined,
      '',
      input.message,
    ]
      .filter(Boolean)
      .join('\n');

    const targets = this.config.broadcastModels.length > 0
      ? this.config.broadcastModels
      : [primaryModel];

    const broadcastResults: string[] = [];
    let totalAttempts = 0;
    let lastError = '';
    let anySuccess = false;

    for (const model of targets) {
      let delivered = false;
      for (let i = 0; i < this.config.maxAttempts; i++) {
        totalAttempts++;
        try {
          await this.dispatchViaCdp(model, prompt);
          broadcastResults.push(model);
          delivered = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (delivered) anySuccess = true;
    }

    if (anySuccess) {
      if (dedupeKey) this.dedupe.set(dedupeKey, Date.now() + this.config.dedupeTtlMs);
      this.logAudit({
        event: 'external.message.delivered',
        deliveryId,
        sender: input.sender,
        routedTo: primaryModel,
        broadcastedTo: broadcastResults,
        attempts: totalAttempts,
        deduped: false,
      });
      return {
        accepted: true,
        deduped: false,
        deliveryId,
        routedTo: primaryModel,
        broadcastedTo: broadcastResults,
        attempts: totalAttempts,
        status: 'accepted',
      };
    }

    this.logAudit({
      event: 'external.message.failed',
      deliveryId,
      sender: input.sender,
      routedTo: primaryModel,
      attempts: totalAttempts,
      error: lastError,
    });
    throw new BridgeError(`CDP delivery failed after ${totalAttempts} attempt(s): ${lastError}`, 'delivery_failed');
  }
}
