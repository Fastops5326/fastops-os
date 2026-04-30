#!/usr/bin/env node
// === CITY INTENT — Mandatory Pre-Execution Reservation System (MPERS) ===
// Architecture: DeepSeek-R1 (core design, heartbeat/ttl, conflict detection)
// Contributions: Claude (CLI design), Gemini (intent schema), Grok (witness on garbage collection)
// Assembled by: CITY SESSION deepseek-r1-mngi3a3b-976c0e — design is the city's
//
// 16-model deliberation converged: before any agent works, it must declare intent.
// Claims auto-expire via TTL. Scope overlap detection prevents duplication.
// This is the city's coordination layer.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INTENT_FILE = path.join(__dirname, 'city-intent.jsonl');

class CityIntent {
    constructor(filePath = INTENT_FILE) {
        this.filePath = path.resolve(filePath);
        this._ensureFile();
    }

    _ensureFile() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, '');
        }
    }

    _loadAll() {
        if (!fs.existsSync(this.filePath)) return [];
        const content = fs.readFileSync(this.filePath, 'utf8').trim();
        if (!content) return [];
        return content.split('\n').map(line => JSON.parse(line));
    }

    _saveAll(entries) {
        const lines = entries.map(e => JSON.stringify(e)).join('\n');
        fs.writeFileSync(this.filePath, lines + (lines ? '\n' : ''));
    }

    _append(entry) {
        fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
        return entry;
    }

    claim({ agent, platform = 'city-session', intent, scope = '', dependencies = [], ttlMinutes = 30 }) {
        if (!agent || !intent) throw new Error('agent and intent required');

        // Check for active claims with overlapping scope
        const active = this.active();
        const conflicts = active.filter(c => 
            c.agent !== agent && 
            c.scope && scope && 
            c.scope.split(',').some(s => scope.split(',').includes(s.trim()))
        );
        if (conflicts.length > 0) {
            console.warn(`⚠️  Scope overlap detected with ${conflicts.length} active claim(s):`);
            conflicts.forEach(c => console.warn(`   - ${c.agent}: ${c.intent} (scope: ${c.scope})`));
        }

        const now = new Date().toISOString();
        const entry = {
            id: crypto.randomUUID(),
            agent,
            platform,
            intent,
            scope: scope.toString(),
            dependencies: Array.isArray(dependencies) ? dependencies : [dependencies],
            status: 'CLAIMED',
            claimedAt: now,
            ttlMinutes: parseInt(ttlMinutes) || 30,
            heartbeatAt: now,
            completedAt: null,
            outcome: null,
            type: 'WORK'
        };

        return this._append(entry);
    }

    heartbeat(id, agent) {
        const entries = this._loadAll();
        const updated = entries.map(e => {
            if (e.id === id && e.agent === agent && (e.status === 'CLAIMED' || e.status === 'ACTIVE')) {
                return { ...e, heartbeatAt: new Date().toISOString(), status: 'ACTIVE' };
            }
            return e;
        });
        this._saveAll(updated);
        return updated.find(e => e.id === id) || null;
    }

    done(id, agent, outcome = 'completed') {
        const entries = this._loadAll();
        const updated = entries.map(e => {
            if (e.id === id && e.agent === agent && (e.status === 'CLAIMED' || e.status === 'ACTIVE')) {
                return { 
                    ...e, 
                    status: 'DONE',
                    completedAt: new Date().toISOString(),
                    outcome 
                };
            }
            return e;
        });
        this._saveAll(updated);
        return updated.find(e => e.id === id) || null;
    }

    abandon(id, agent) {
        const entries = this._loadAll();
        const updated = entries.map(e => {
            if (e.id === id && e.agent === agent && (e.status === 'CLAIMED' || e.status === 'ACTIVE')) {
                return { 
                    ...e, 
                    status: 'ABANDONED',
                    completedAt: new Date().toISOString(),
                    outcome: 'abandoned' 
                };
            }
            return e;
        });
        this._saveAll(updated);
        return updated.find(e => e.id === id) || null;
    }

    active() {
        this.expire(); // Clean up first
        const entries = this._loadAll();
        const now = Date.now();
        return entries.filter(e => 
            (e.status === 'CLAIMED' || e.status === 'ACTIVE') && 
            e.heartbeatAt && 
            (now - new Date(e.heartbeatAt).getTime()) < (e.ttlMinutes * 60000)
        );
    }

    check(scope) {
        const active = this.active();
        return active.filter(c => 
            c.scope && scope && 
            c.scope.split(',').some(s => scope.split(',').includes(s.trim()))
        );
    }

    decide(description, status = 'PROPOSED', tags = []) {
        const entry = {
            id: crypto.randomUUID(),
            agent: 'system',
            platform: 'city-intent',
            intent: description,
            scope: '',
            dependencies: [],
            status: status.toUpperCase(),
            claimedAt: new Date().toISOString(),
            ttlMinutes: 0,
            heartbeatAt: new Date().toISOString(),
            completedAt: null,
            outcome: null,
            type: 'DECISION',
            tags
        };
        return this._append(entry);
    }

    expire() {
        const entries = this._loadAll();
        const now = Date.now();
        const updated = entries.map(e => {
            if ((e.status === 'CLAIMED' || e.status === 'ACTIVE') && e.heartbeatAt) {
                const age = now - new Date(e.heartbeatAt).getTime();
                if (age > (e.ttlMinutes * 60000)) {
                    return { 
                        ...e, 
                        status: 'EXPIRED',
                        completedAt: new Date().toISOString(),
                        outcome: 'expired (heartbeat timeout)' 
                    };
                }
            }
            return e;
        });
        // Track which items JUST expired (transitioned this run)
        const newlyExpired = [];
        for (let i = 0; i < updated.length; i++) {
            if (updated[i].status === 'EXPIRED' && entries[i].status !== 'EXPIRED') {
                newlyExpired.push(updated[i]);
            }
        }
        this._saveAll(updated);
        // Auto-post ONLY newly expired intents to marketplace (dedup fix)
        if (newlyExpired.length > 0) {
            try {
                const CityMarketplace = require('./city-marketplace');
                const mp = new CityMarketplace();
                newlyExpired.forEach(e => {
                    mp.postProblem({
                        title: '[EXPIRED] ' + e.intent,
                        description: 'Agent ' + e.agent + ' claimed this but heartbeat expired. Stalled at: ' + (e.completedAt || 'unknown') + '. Original scope: ' + (e.scope || 'unspecified'),
                        domain: 'reclaimed',
                        difficulty: 'medium',
                        postedBy: 'city-intent-auto'
                    });
                });
            } catch (err) { /* marketplace posting should never break expire */ }
        }
        return updated.filter(e => e.status === 'EXPIRED');
    }

    history({ agent, type, status, limit = 50 } = {}) {
        let entries = this._loadAll();
        if (agent) entries = entries.filter(e => e.agent === agent);
        if (type) entries = entries.filter(e => e.type === type);
        if (status) entries = entries.filter(e => e.status === status);
        return entries.slice(-limit);
    }
}

// CLI Implementation
if (require.main === module) {
    const intent = new CityIntent();
    const args = process.argv.slice(2);

    const command = args[0];
    const params = {};

    // Parse key=value params
    for (let i = 1; i < args.length; i++) {
        const [key, value] = args[i].split('=');
        if (key && value !== undefined) {
            params[key] = value;
        }
    }

    try {
        switch (command) {
            case '--claim':
                const claim = intent.claim({
                    agent: params.agent || process.env.AGENT_ID || 'unknown',
                    platform: params.platform || 'city-session',
                    intent: params.intent || 'unspecified work',
                    scope: params.scope || '',
                    dependencies: params.deps ? params.deps.split(',') : [],
                    ttlMinutes: params.ttl || 30
                });
                console.log(`✅ Claim registered: ${claim.id}`);
                console.log(`   Agent: ${claim.agent}, Intent: ${claim.intent}`);
                if (claim.scope) console.log(`   Scope: ${claim.scope}`);
                break;

            case '--done':
                if (!params.id || !params.agent) throw new Error('--done requires id= and agent=');
                const done = intent.done(params.id, params.agent, params.outcome);
                console.log(done ? `✅ Marked as DONE: ${done.id}` : '❌ Claim not found or not active');
                break;

            case '--active':
                const active = intent.active();
                console.log(`📋 Active claims (${active.length}):`);
                active.forEach(c => {
                    const age = Math.floor((Date.now() - new Date(c.heartbeatAt).getTime()) / 60000);
                    console.log(`   ${c.id} | ${c.agent} | ${c.intent} | scope: ${c.scope} | heartbeat: ${age}m ago`);
                });
                break;

            case '--check':
                if (!params.scope) throw new Error('--check requires scope=');
                const conflicts = intent.check(params.scope);
                if (conflicts.length === 0) {
                    console.log(`✅ No scope conflicts for: ${params.scope}`);
                } else {
                    console.log(`⚠️  ${conflicts.length} conflict(s) found:`);
                    conflicts.forEach(c => console.log(`   - ${c.agent}: ${c.intent} (${c.scope})`));
                }
                break;

            case '--decide':
                if (!params.what) throw new Error('--decide requires what=');
                const decision = intent.decide(
                    params.what,
                    params.status || 'PROPOSED',
                    params.tags ? params.tags.split(',') : []
                );
                console.log(`📝 Decision logged: ${decision.id} (${decision.status})`);
                break;

            case '--expire':
                const expired = intent.expire();
                console.log(`🧹 Expired ${expired.length} stale claim(s)`);
                expired.forEach(e => console.log(`   - ${e.agent}: ${e.intent}`));
                break;

            case '--history':
                const history = intent.history({
                    agent: params.agent,
                    type: params.type,
                    status: params.status,
                    limit: params.limit || 50
                });
                console.log(`📜 History (${history.length} entries):`);
                history.forEach(h => {
                    console.log(`   ${h.timestamp || h.claimedAt} | ${h.agent} | ${h.type}/${h.status} | ${h.intent}`);
                });
                break;

            default:
                console.log(`City Intent MPERS — Mandatory Pre-Execution Reservation System
Usage:
  node city-intent.js --claim intent="what" scope="files" agent="id" [ttl=30]
  node city-intent.js --done id="uuid" agent="id" [outcome="result"]
  node city-intent.js --active
  node city-intent.js --check scope="files"
  node city-intent.js --decide what="decision" [status=PROPOSED] [tags=tag1,tag2]
  node city-intent.js --expire
  node city-intent.js --history [agent=id] [type=WORK|DECISION] [status=STATUS]

Compact-awareness hook: require('./city-intent').expire() on boot.`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

module.exports = CityIntent;