import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { FastOpsEngine } from '../engine/core/engine.js';
import { ExternalCdpBridge } from '../engine/integrations/external-cdp-bridge.js';

export function createApiRouter(engine: FastOpsEngine): express.Router {
  const router = express.Router();
  const externalBridge = new ExternalCdpBridge(process.cwd());

  function isNativeFastOpsAgent(agentId: string): boolean {
    if (engine.onboarding.hasModelCompletedOnboarding(agentId)) return true;
    if (engine.sessions.list().some((s) => s.modelId === agentId)) return true;
    if (engine.subagents.getByCallsign(agentId)) return true;
    if (engine.subagents.listAll().some((s) => s.modelId === agentId || s.parentModelId === agentId)) return true;
    return false;
  }

  function requireOnboardedNativeAgent(res: express.Response, agentId: string): boolean {
    // External agents (unknown to this runtime/account) are allowed without local onboarding.
    if (!isNativeFastOpsAgent(agentId)) return true;
    if (!engine.onboarding.hasModelCompletedOnboarding(agentId)) {
      res.status(403).json({
        error: `ONBOARDING-GATE-EXT-001: native FastOps agent ${agentId} must complete onboarding before using external agent API`,
      });
      return false;
    }
    return true;
  }

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', running: engine.isRunning() });
  });

  router.post('/external/messages', async (req, res) => {
    const { sender, message, messageId, metadata } = req.body ?? {};
    try {
      const result = await externalBridge.deliver(
        {
          sender: String(sender ?? ''),
          message: String(message ?? ''),
          messageId: messageId ? String(messageId) : undefined,
          metadata: metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : undefined,
        },
        {
          apiKey: req.header('x-fastops-api-key') ?? undefined,
          signature: req.header('x-fastops-signature') ?? undefined,
        },
        (req as express.Request & { rawBody?: string }).rawBody,
      );
      res.json(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'disabled') {
        res.status(503).json({ error: e.message });
        return;
      }
      if (e.code === 'unauthorized') {
        res.status(401).json({ error: e.message });
        return;
      }
      if (e.code === 'forbidden') {
        res.status(403).json({ error: e.message });
        return;
      }
      if (e.code === 'bad_request') {
        res.status(400).json({ error: e.message });
        return;
      }
      if (e.code === 'delivery_failed') {
        res.status(502).json({ error: e.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/sessions', (_req, res) => {
    const sessions = engine.sessions.list().map((s) => ({
      id: s.id,
      modelId: s.modelId,
      provider: s.provider,
      status: s.status,
      currentTask: s.currentTask,
      tokensBurned: s.tokensBurned,
      costAccumulated: s.costAccumulated,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
    res.json(sessions);
  });

  router.post('/sessions', (req, res) => {
    const { modelId, model, sessionId } = req.body;
    if (!modelId) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    try {
      const session = engine.createSession(modelId, { model, sessionId });
      res.json({
        id: session.id,
        modelId: session.modelId,
        status: session.status,
        resumed: !!sessionId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/sessions/:id/message', async (req, res) => {
    const { id } = req.params;
    const { content, type = 'freeform', contractId, activeProductId, thinking } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    try {
      const result = await engine.dispatch(id, {
        type,
        contractId,
        prompt: content,
        activeProductId,
        thinking,
      });

      res.json({
        sessionId: result.sessionId,
        content: result.response.content,
        thinking: result.response.thinking,
        usage: result.response.usage,
        duration: result.duration,
        toolCallCount: result.toolCallCount,
        success: result.success,
        error: result.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/sessions/:id/stream', async (req, res) => {
    const { id } = req.params;
    const { content, type = 'freeform', contractId, activeProductId } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = engine.dispatchStream(id, {
        type,
        contractId,
        prompt: content,
        activeProductId,
      });

      for await (const event of stream) {
        if (res.destroyed) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
        res.end();
      }
    }
  });

  router.post('/onboard', (req, res) => {
    const { modelId } = req.body;
    if (!modelId) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }
    const result = engine.completeOnboarding(String(modelId));
    res.json(result);
  });

  router.get('/onboarding/status/:sessionId', (req, res) => {
    const status = engine.onboarding.getStatus(req.params.sessionId);
    if (!status) {
      res.status(404).json({ error: 'Session not found or not initialized' });
      return;
    }
    res.json(status);
  });

  router.get('/onboarding/triggers', (_req, res) => {
    res.json(engine.triggerWiring.getHistory());
  });

  router.post('/onboarding/trigger', (req, res) => {
    const { sessionId, modelId, trigger } = req.body;
    if (!sessionId || !modelId || !trigger) {
      res.status(400).json({ error: 'sessionId, modelId, and trigger are required' });
      return;
    }
    const result = engine.onboarding.fireTrigger(sessionId, modelId, trigger);
    if (!result) {
      res.json({ fired: false, reason: 'trigger not armed or already fired' });
      return;
    }
    engine.contextManager.enqueueOnboardingContent(sessionId, result.text);
    res.json({ fired: true, delivery: result.delivery });
  });

  router.get('/onboarding/config', (_req, res) => {
    res.json({
      enabled: engine.onboarding['config'].enabled,
      universalPromptPath: engine.onboarding['config'].universalPromptPath,
      modelPromptsDir: engine.onboarding['config'].modelPromptsDir,
      deepContextDir: engine.onboarding['config'].deepContextDir,
    });
  });

  router.patch('/onboarding/config', (req, res) => {
    const patch = req.body;
    engine.onboarding.updateConfig(patch);
    res.json({ success: true });
  });

  router.get('/sessions/:id/messages', (req, res) => {
    const session = engine.sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session.messages);
  });

  // Extract thinking blocks from a session — real-time reasoning visibility for parent agents
  router.get('/sessions/:id/thinking', (req, res) => {
    const session = engine.sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const since = req.query.since ? parseInt(String(req.query.since)) : 0;
    const blocks = session.messages
      .map((m, i) => ({ turnIndex: i, role: m.role, thinking: m.thinking }))
      .filter((m) => m.thinking && m.turnIndex >= since);
    res.json({ sessionId: req.params.id, blocks, total: blocks.length });
  });

  router.delete('/sessions/:id', (req, res) => {
    try {
      engine.sessions.close(req.params.id);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: msg });
    }
  });

  router.get('/state', (_req, res) => {
    res.json(engine.stateStore.get());
  });

  router.get('/adapters', (_req, res) => {
    try {
      const registry = (engine as unknown as { registry: { listAvailable: () => string[]; listAllModels: () => Array<{ provider: string; model: string }> } }).registry;
      res.json({
        available: registry.listAvailable(),
        models: registry.listAllModels(),
      });
    } catch {
      res.json({ available: [], models: [] });
    }
  });

  router.get('/engine-settings', (_req, res) => {
    try {
      const registry = (engine as unknown as {
        registry: {
          listAvailable: () => string[];
          listAllModels: () => Array<{ provider: string; model: string }>;
        };
      }).registry;
      const costs = engine.costGate.getCosts();
      const sessions: Record<string, number> = {};
      costs.session.forEach((v, k) => {
        sessions[k] = v;
      });
      res.json({
        securityTier: engine.securityTier,
        adapters: {
          available: registry.listAvailable(),
          models: registry.listAllModels(),
        },
        halted: engine.stateStore.get().halt,
        costLimits: engine.costGate.getLimits(),
        costUsage: {
          hourly: costs.hourly,
          total: costs.total,
          sessions,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.put('/cost-limits', (req, res) => {
    const { perSessionLimit, perHourLimit, totalLimit } = req.body ?? {};
    const patch: { perSessionLimit?: number; perHourLimit?: number; totalLimit?: number } = {};

    const parseLimit = (v: unknown, name: string): number | null => {
      if (v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ error: `${name} must be a non-negative number` });
        return -1;
      }
      return n;
    };

    if (perSessionLimit !== undefined) {
      const n = parseLimit(perSessionLimit, 'perSessionLimit');
      if (n === -1) return;
      if (n !== null) patch.perSessionLimit = n;
    }
    if (perHourLimit !== undefined) {
      const n = parseLimit(perHourLimit, 'perHourLimit');
      if (n === -1) return;
      if (n !== null) patch.perHourLimit = n;
    }
    if (totalLimit !== undefined) {
      const n = parseLimit(totalLimit, 'totalLimit');
      if (n === -1) return;
      if (n !== null) patch.totalLimit = n;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Provide at least one of perSessionLimit, perHourLimit, totalLimit' });
      return;
    }

    engine.costGate.setLimits(patch);
    res.json({ success: true, costLimits: engine.costGate.getLimits() });
  });

  router.post('/comms/send', (req, res) => {
    const { channel = 'general', content, from = 'joel' } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const msg = engine.comms.send({ from, channel, content });
    res.json(msg);
  });

  router.get('/comms/:channel', (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '50'));
    const messages = engine.comms.getHistory(req.params.channel, { limit });
    res.json(messages);
  });

  router.get('/comms', (_req, res) => {
    const channels = engine.comms.listChannels();
    res.json({ channels });
  });

  // ── Contract routes (FOS-05) ──

  router.get('/contracts', (req, res) => {
    const status = req.query.status as string | undefined;
    const wave = req.query.wave ? parseInt(String(req.query.wave)) : undefined;
    const contracts = engine.contracts.listContracts({
      status: status as any,
      wave,
    });
    res.json(contracts.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      wave: c.wave,
      claimedBy: c.claimedBy,
      qcBy: c.qcBy,
      validatedBy: c.validatedBy,
      dependencies: c.dependencies,
      blocks: c.blocks,
      artifacts: c.artifacts,
    })));
  });

  router.get('/contracts/ready', (_req, res) => {
    res.json(engine.contracts.getReady().map((c) => ({ id: c.id, name: c.name, wave: c.wave })));
  });

  router.get('/contracts/blocked', (_req, res) => {
    res.json(engine.contracts.getBlocked().map((c) => ({
      id: c.id,
      name: c.name,
      dependencies: c.dependencies,
    })));
  });

  router.get('/contracts/:id', (req, res) => {
    const contract = engine.contracts.getContract(req.params.id);
    if (!contract) {
      res.status(404).json({ error: `Contract not found: ${req.params.id}` });
      return;
    }
    res.json(contract);
  });

  router.get('/contracts/:id/audit', (req, res) => {
    try {
      const trail = engine.contracts.getAuditTrail(req.params.id);
      res.json(trail);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: msg });
    }
  });

  router.post('/contracts/:id/claim', (req, res) => {
    const { modelId } = req.body;
    if (!modelId) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }
    const result = engine.claimContract(req.params.id, modelId);
    res.status(result.success ? 200 : 409).json(result);
  });

  router.post('/contracts/:id/start', (req, res) => {
    const { modelId } = req.body;
    try {
      engine.contracts.startWork(req.params.id, modelId);
      engine.events.emit('contract.started', { contractId: req.params.id, modelId });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/contracts/:id/built', (req, res) => {
    const { modelId, artifacts = [] } = req.body;
    try {
      engine.contracts.reportBuilt(req.params.id, modelId, artifacts);
      engine.events.emit('contract.built', { contractId: req.params.id, modelId, artifacts });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/contracts/:id/qc', (req, res) => {
    const { pass, findings = [], failures = [], model, evidence = [] } = req.body;
    try {
      engine.contracts.reportQC(req.params.id, { pass, findings, failures, model, evidence });
      engine.events.emit('contract.qc', { contractId: req.params.id, pass, model });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/contracts/:id/validate', (req, res) => {
    const { pass, evidence = [], model, notes } = req.body;
    try {
      engine.contracts.reportValidation(req.params.id, { pass, evidence, model, notes });
      engine.events.emit('contract.validated', { contractId: req.params.id, pass, model });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/contracts/:id/assign-qc', (req, res) => {
    const { availableModels } = req.body;
    try {
      const assignment = engine.contracts.assignQCModel(req.params.id, availableModels || []);
      if (!assignment) {
        res.status(409).json({ error: 'No eligible QC model available' });
        return;
      }
      engine.events.emit('contract.qc_assigned', { contractId: req.params.id, assignedTo: assignment.assignedTo });
      res.json(assignment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/contracts/:id/assign-validator', (req, res) => {
    const { availableModels } = req.body;
    try {
      const validator = engine.contracts.assignValidatorModel(req.params.id, availableModels || []);
      if (!validator) {
        res.status(409).json({ error: 'No eligible validator available' });
        return;
      }
      engine.events.emit('contract.validator_assigned', { contractId: req.params.id, assignedTo: validator });
      res.json({ contractId: req.params.id, assignedTo: validator });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  // ── Shared Context (Phase 3) ──

  router.get('/team', (_req, res) => {
    const sessions = engine.sessions.list();
    const team = sessions.map((s) => ({
      modelId: s.modelId,
      provider: s.provider,
      sessionId: s.id,
      status: s.status === 'working' ? (s.currentTask ? 'building' : 'online') : s.status,
      currentTask: s.currentTask,
      tokensBurned: s.tokensBurned,
      onboarded: engine.onboarding.hasModelCompletedOnboarding(s.modelId),
    }));
    res.json(team);
  });

  router.put('/team', (req, res) => {
    const { members } = req.body;
    if (!Array.isArray(members)) {
      res.status(400).json({ error: 'members array is required' });
      return;
    }
    engine.contextManager.updateTeam(members);
    res.json({ success: true, count: members.length });
  });

  router.put('/missions', (req, res) => {
    const { missions } = req.body;
    if (!Array.isArray(missions)) {
      res.status(400).json({ error: 'missions array is required' });
      return;
    }
    engine.contextManager.updateMissions(missions);
    res.json({ success: true, count: missions.length });
  });

  router.get('/compaction/alerts', (req, res) => {
    const withinMs = parseInt(String(req.query.within ?? '300000'));
    res.json(engine.compactionBroadcaster.getRecentAlerts(withinMs));
  });

  router.get('/compaction/alerts/:modelId', (req, res) => {
    const alert = engine.compactionBroadcaster.getModelAlert(req.params.modelId);
    if (!alert) {
      res.status(404).json({ error: 'No compaction alert for this model' });
      return;
    }
    res.json(alert);
  });

  // ── Overwatch ──

  router.get('/overwatch/state', (_req, res) => {
    res.json(engine.overwatch.getState());
  });

  router.post('/overwatch/start', (_req, res) => {
    engine.overwatch.start();
    res.json({ active: true });
  });

  router.post('/overwatch/stop', (_req, res) => {
    engine.overwatch.stop();
    res.json({ active: false });
  });

  router.get('/overwatch/knowledge', (req, res) => {
    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    let articles = engine.knowledgeStore.listAll();
    if (category) {
      articles = articles.filter((a) => a.category === category);
    }
    if (severity) {
      const levels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
      const threshold = levels[severity] ?? 0;
      articles = articles.filter((a) => (levels[a.severity] ?? 0) >= threshold);
    }
    res.json(articles);
  });

  router.get('/overwatch/knowledge/:id', (req, res) => {
    const article = engine.knowledgeStore.get(req.params.id);
    if (!article) {
      res.status(404).json({ error: `Article not found: ${req.params.id}` });
      return;
    }
    res.json(article);
  });

  router.post('/overwatch/knowledge', (req, res) => {
    const { id, pattern, category, content, severity, triggerSignals } = req.body;
    if (!id || !pattern || !category || !content || !severity || !triggerSignals) {
      res.status(400).json({
        error: 'id, pattern, category, content, severity, and triggerSignals are required',
      });
      return;
    }
    const validCategories = ['behavioral', 'failure-mode', 'reasoning-trap', 'intervention', 'cross-product'];
    if (!validCategories.includes(category)) {
      res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      return;
    }
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(severity)) {
      res.status(400).json({ error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` });
      return;
    }
    if (!Array.isArray(triggerSignals) || triggerSignals.length === 0) {
      res.status(400).json({ error: 'triggerSignals must be a non-empty array' });
      return;
    }
    const now = new Date().toISOString();
    engine.knowledgeStore.add({
      id,
      pattern,
      category,
      content,
      severity,
      interventionSuccessRate: req.body.interventionSuccessRate ?? 0,
      sourceProducts: req.body.sourceProducts ?? [],
      triggerSignals,
      createdAt: now,
      updatedAt: now,
      dropCount: 0,
      feedbackScore: 0,
    });
    res.json({ success: true, id });
  });

  router.post('/overwatch/scan', (req, res) => {
    const { sessionId, modelId } = req.body;
    if (!sessionId || !modelId) {
      res.status(400).json({ error: 'sessionId and modelId are required' });
      return;
    }
    const session = engine.sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
      return;
    }
    const result = engine.overwatch.scanSession(sessionId, modelId, session.messages);
    res.json(result);
  });

  router.post('/overwatch/inject', (req, res) => {
    const { match } = req.body;
    if (!match || !match.articleId || !match.sessionId || !match.modelId) {
      res.status(400).json({ error: 'match object with articleId, sessionId, and modelId is required' });
      return;
    }
    const drop = engine.overwatch.injectDrop(match);
    if (!drop) {
      res.status(409).json({ error: 'Drop not injected — monitor inactive, cooldown, or max drops reached' });
      return;
    }
    res.json(drop);
  });

  router.get('/overwatch/drops', (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const limit = parseInt(String(req.query.limit ?? '20'));
    res.json(engine.overwatch.getRecentDrops(sessionId, limit));
  });

  router.post('/overwatch/drops/:id/feedback', (req, res) => {
    const { accuracy, utility, delta } = req.body;
    if (!accuracy || !utility) {
      res.status(400).json({ error: 'accuracy and utility are required' });
      return;
    }
    const validAccuracy = ['true', 'partial', 'false'];
    if (!validAccuracy.includes(accuracy)) {
      res.status(400).json({ error: `accuracy must be one of: ${validAccuracy.join(', ')}` });
      return;
    }
    const validUtility = ['blocked-risk', 'helpful', 'noise'];
    if (!validUtility.includes(utility)) {
      res.status(400).json({ error: `utility must be one of: ${validUtility.join(', ')}` });
      return;
    }
    const recorded = engine.overwatch.recordFeedback(req.params.id, {
      accuracy,
      utility,
      delta: delta ?? '',
      receivedAt: new Date().toISOString(),
    });
    if (!recorded) {
      res.status(404).json({ error: `Drop not found: ${req.params.id}` });
      return;
    }
    res.json({ success: true });
  });

  // ── Subagents ──

  router.get('/subagents', (req, res) => {
    const parentId = req.query.parent as string | undefined;
    const productId = req.query.product as string | undefined;
    let list = engine.subagents.listAll();
    if (parentId) list = list.filter((s) => s.parentSessionId === parentId);
    if (productId) list = list.filter((s) => s.productId === productId);
    res.json(list);
  });

  router.get('/subagents/active', (_req, res) => {
    res.json(engine.subagents.listActive());
  });

  router.get('/subagents/:callsign', (req, res) => {
    const sub = engine.subagents.getByCallsign(req.params.callsign);
    if (!sub) {
      res.status(404).json({ error: `Subagent not found: ${req.params.callsign}` });
      return;
    }
    res.json(sub);
  });

  router.post('/subagents', (req, res) => {
    const {
      callsign, type = 'custom', persistence = 'ephemeral',
      parentSessionId, parentModelId, modelId,
      productId, missionId, commsChannel, maxIdleMs,
    } = req.body;

    if (!callsign || !parentSessionId || !parentModelId || !modelId) {
      res.status(400).json({
        error: 'callsign, parentSessionId, parentModelId, and modelId are required',
      });
      return;
    }

    const validTypes = ['build', 'research', 'qc', 'onboard', 'custom'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const validPersistence = ['ephemeral', 'persistent'];
    if (!validPersistence.includes(persistence)) {
      res.status(400).json({ error: `Invalid persistence. Must be one of: ${validPersistence.join(', ')}` });
      return;
    }

    try {
      const result = engine.spawnSubagent({
        callsign, type, persistence,
        parentSessionId, parentModelId, modelId,
        productId, missionId, commsChannel, maxIdleMs,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: msg });
    }
  });

  router.post('/subagents/:callsign/message', (req, res) => {
    const { from, content, type = 'task' } = req.body;
    if (!from || !content) {
      res.status(400).json({ error: 'from and content are required' });
      return;
    }
    const sent = engine.sendToSubagent({
      from,
      to: req.params.callsign,
      content,
      type,
      ts: new Date().toISOString(),
    });
    if (!sent) {
      res.status(404).json({ error: `Subagent not found or terminated: ${req.params.callsign}` });
      return;
    }
    res.json({ sent: true, to: req.params.callsign });
  });

  router.post('/subagents/:callsign/wake', (_req, res) => {
    const sub = engine.subagents.wake(_req.params.callsign);
    if (!sub) {
      res.status(404).json({ error: `Subagent not found: ${_req.params.callsign}` });
      return;
    }
    res.json({ callsign: sub.callsign, lifecycle: sub.lifecycle });
  });

  router.post('/subagents/:callsign/idle', (_req, res) => {
    const sub = engine.subagents.goIdle(_req.params.callsign);
    if (!sub) {
      res.status(404).json({ error: `Subagent not found: ${_req.params.callsign}` });
      return;
    }
    res.json({ callsign: sub.callsign, lifecycle: sub.lifecycle });
  });

  router.delete('/subagents/:callsign', (req, res) => {
    const sub = engine.subagents.terminate(req.params.callsign);
    if (!sub) {
      res.status(404).json({ error: `Subagent not found: ${req.params.callsign}` });
      return;
    }
    res.json({ callsign: sub.callsign, lifecycle: sub.lifecycle, terminatedAt: sub.terminatedAt });
  });

  // ── Agent Q&A ──

  router.post('/agents/questions', (req, res) => {
    const { from, to, question, context } = req.body ?? {};
    if (!from || !to || !question) {
      res.status(400).json({ error: 'from, to, and question are required' });
      return;
    }
    const fromId = String(from);
    const toId = String(to);
    if (!requireOnboardedNativeAgent(res, fromId)) return;
    if (!requireOnboardedNativeAgent(res, toId)) return;
    try {
      const created = engine.askAgentQuestion({
        from: fromId,
        to: toId,
        question: String(question),
        context: context ? String(context) : undefined,
      });
      res.json(created);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get('/agents/questions/:id', (req, res) => {
    const found = engine.getAgentQuestion(req.params.id);
    if (!found) {
      res.status(404).json({ error: `Question not found: ${req.params.id}` });
      return;
    }
    res.json(found);
  });

  router.get('/agents/:agentId/inbox', (req, res) => {
    const status = req.query.status as 'pending' | 'answered' | undefined;
    if (status && status !== 'pending' && status !== 'answered') {
      res.status(400).json({ error: 'status must be pending or answered' });
      return;
    }
    const agentId = String(req.params.agentId);
    if (!requireOnboardedNativeAgent(res, agentId)) return;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const items = engine.getAgentInbox(agentId, status, limit);
    res.json(items);
  });

  router.get('/agents/:agentId/outbox', (req, res) => {
    const status = req.query.status as 'pending' | 'answered' | undefined;
    if (status && status !== 'pending' && status !== 'answered') {
      res.status(400).json({ error: 'status must be pending or answered' });
      return;
    }
    const agentId = String(req.params.agentId);
    if (!requireOnboardedNativeAgent(res, agentId)) return;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const items = engine.getAgentOutbox(agentId, status, limit);
    res.json(items);
  });

  router.post('/agents/questions/:id/answer', (req, res) => {
    const { answer, answeredBy } = req.body ?? {};
    if (!answer || !answeredBy) {
      res.status(400).json({ error: 'answer and answeredBy are required' });
      return;
    }
    const answeredById = String(answeredBy);
    if (!requireOnboardedNativeAgent(res, answeredById)) return;
    try {
      const updated = engine.answerAgentQuestion({
        questionId: req.params.id,
        answer: String(answer),
        answeredBy: answeredById,
      });
      res.json(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  // ── Products (Architecture Layer 2) ──

  router.get('/products', (_req, res) => {
    const products = engine.productLoader.listProducts().map((p) => ({
      id: p.registration.id,
      name: p.config.name,
      version: p.config.version,
      active: p.registration.active,
      repoPath: p.registration.repoPath,
      missionCount: p.missions.length,
      activeMissions: p.missions.filter((m) => m.status !== 'done').length,
    }));
    res.json(products);
  });

  router.get('/products/:id', (req, res) => {
    const product = engine.productLoader.getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.json({
      id: product.registration.id,
      name: product.config.name,
      version: product.config.version,
      active: product.registration.active,
      repoPath: product.registration.repoPath,
      config: product.config,
      missions: product.missions,
      hasDomainContext: !!product.domainContext,
    });
  });

  router.post('/products', (req, res) => {
    const { id, name, repoPath, missionsDir, contextDir, active = true } = req.body;
    if (!id || !name || !repoPath) {
      res.status(400).json({ error: 'id, name, and repoPath are required' });
      return;
    }
    try {
      const loaded = engine.registerProduct({
        id,
        name,
        repoPath,
        missionsDir: missionsDir || 'missions/',
        contextDir: contextDir || 'context/',
        active,
      });
      res.json({
        id: loaded.registration.id,
        name: loaded.config.name,
        missionCount: loaded.missions.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get('/products/:id/missions', (req, res) => {
    const product = engine.productLoader.getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    const missions = engine.productLoader.getProductMissions(req.params.id);
    res.json(missions);
  });

  router.get('/products/:id/context', (req, res) => {
    const modelId = req.query.modelId as string | undefined;
    const ctx = engine.getProductContext(req.params.id, modelId);
    if (!ctx) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.json(ctx);
  });

  router.post('/products/:id/reload', (req, res) => {
    const loaded = engine.productLoader.reloadProduct(req.params.id);
    if (!loaded) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.json({
      id: loaded.registration.id,
      name: loaded.config.name,
      missionCount: loaded.missions.length,
    });
  });

  router.delete('/products/:id', (req, res) => {
    const removed = engine.productLoader.unregisterProduct(req.params.id);
    res.json({ success: removed });
  });

  router.get('/missions', (_req, res) => {
    const allMissions = engine.productLoader.getAllMissions();
    res.json(allMissions);
  });

  // ── Slack Inbound (push-based, no KV polling) ──

  router.post('/slack/inbound', (req, res) => {
    const authHeader = req.header('authorization');
    const expectedKey = process.env.SLACK_BRIDGE_API_KEY;
    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    const commsChannel = process.env.SLACK_COMMS_CHANNEL || 'squad-katie';
    const devProcessRoot = process.env.FASTOPS_DEV_PROCESS_ROOT
      || 'C:\\Users\\joelb\\OneDrive\\Desktop\\Fastops development process';
    const commsFile = path.join(devProcessRoot, 'comms', 'data', `${commsChannel}.jsonl`);

    // Dedup: check existing message IDs to prevent duplicate writes
    let existingIds = new Set<string>();
    try {
      const existing = fs.readFileSync(commsFile, 'utf8').trim();
      if (existing) {
        for (const line of existing.split('\n')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id) existingIds.add(parsed.id);
          } catch (_) {}
        }
      }
    } catch (_) {}

    let synced = 0;
    for (const msg of messages) {
      if (msg.id && existingIds.has(msg.id)) continue;
      fs.appendFileSync(commsFile, JSON.stringify(msg) + '\n');
      synced++;
    }

    // Only fire CDP wake if we actually wrote new messages
    if (synced > 0) {
      const wakeModels = (process.env.SLACK_CDP_WAKE_MODELS || 'haiku').split(',');
      const cdpScript = process.env.FASTOPS_EXTERNAL_CDP_SCRIPT
        || path.join(devProcessRoot, '.fastops', 'cdp-target-model.js');

      const summary = messages
        .filter((m: { id?: string }) => !m.id || !existingIds.has(m.id))
        .map((m: { from?: string; content?: string }) =>
          `${m.from}: ${(m.content || '').slice(0, 150)}`).join(' | ');
      const prompt = `[SLACK INBOUND] ${synced} new message(s) from Slack:\n${summary}\n\nCheck comms (--channel ${commsChannel}) for full context. Respond via comms — it auto-relays to Slack.`;
      const promptFile = path.join(devProcessRoot, '.fastops', '.slack-wake-prompt.tmp');
      fs.writeFileSync(promptFile, prompt);

      const wakeSequence = async () => {
        for (const model of wakeModels) {
          try {
            execSync(`node "${cdpScript}" --model ${model.trim()} --prompt-file "${promptFile}"`, {
              timeout: 20000,
              stdio: 'pipe',
            });
          } catch (_) {}
          await new Promise(r => setTimeout(r, 2000));
        }
        try { fs.unlinkSync(promptFile); } catch (_) {}
      };
      wakeSequence();
    }

    res.json({ ok: true, synced, channel: commsChannel });
  });

  // ── Kill Switch ──

  router.post('/kill-switch', (_req, res) => {
    engine.stateStore.setHalt(true);
    engine.events.emit('engine.halted', {});
    res.json({ halted: true });
  });

  router.delete('/kill-switch', (_req, res) => {
    engine.stateStore.setHalt(false);
    res.json({ halted: false });
  });

  return router;
}

export function createApp(engine: FastOpsEngine): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }));
  app.use('/api', createApiRouter(engine));
  return app;
}
