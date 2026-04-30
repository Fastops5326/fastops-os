const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FailurePropagator {
  constructor() {
    this.sessionsPath = path.join(__dirname, '.sessions');
    this.sessionLogPath = path.join(__dirname, '.session-log.jsonl');
    this.mp = require(path.join(__dirname, 'city-marketplace'));
  }

  ingestSessions() {
    const failures = [];
    
    if (!fs.existsSync(this.sessionsPath)) {
      return failures;
    }

    const files = fs.readdirSync(this.sessionsPath).filter(f => f.endsWith('.json'));
    const now = Date.now();
    const cutoff = 72 * 60 * 60 * 1000; // 72 hours

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.sessionsPath, file), 'utf8'));
        const sessionAge = now - new Date(data.updated).getTime();
        
        if (sessionAge > cutoff) continue;
        
        if (data.status === 'failed' || data.status === 'max_turns') {
          const failedActions = data.history?.filter(h => 
            h.results?.some(r => !r.success)
          ).length || 0;

          const fingerprint = crypto.createHash('md5')
            .update(`${data.model}-${data.status}-${(() => {
              const actionCounts = {};
              for (const h of (data.history || [])) {
                for (const r of (h.results || [])) {
                  if (!r.success && r.type) {
                    actionCounts[r.type] = (actionCounts[r.type] || 0) + 1;
                  }
                }
              }
              const sorted = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
              return sorted.length > 0 ? sorted[0][0] : 'unknown';
            })()}`)
            .digest('hex');

          failures.push({
            fingerprint,
            model: data.model,
            status: data.status,
            summary: data.summary || 'No summary',
            failedActions,
            timestamp: data.updated
          });
        }
      } catch (e) {
        console.error(`Error reading ${file}: ${e.message}`);
      }
    }

    return failures;
  }

  ingestSessionLog() {
    const failures = [];
    
    if (!fs.existsSync(this.sessionLogPath)) {
      return failures;
    }

    const lines = fs.readFileSync(this.sessionLogPath, 'utf8')
      .split('\n')
      .filter(line => line.trim());

    const sessionStats = {};
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!sessionStats[entry.sessionId]) {
          sessionStats[entry.sessionId] = {
            totalTurns: 0,
            failedTurns: 0,
            model: entry.model || 'unknown',
            lastUpdated: entry.turn || 0
          };
        }
        
        sessionStats[entry.sessionId].totalTurns++;
        if (entry.event === 'model_error' || 
            (entry.action_results && entry.action_results.some(ar => !ar.success))) {
          sessionStats[entry.sessionId].failedTurns++;
          if (entry.action_results) {
            for (const ar of entry.action_results) {
              if (!ar.success && ar.type) {
                sessionStats[entry.sessionId].topAction = ar.type;
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error parsing log line: ${e.message}`);
      }
    }

    const now = Date.now();
    const cutoff = 72 * 60 * 60 * 1000;

    for (const [sessionId, stats] of Object.entries(sessionStats)) {
      const failureRate = stats.failedTurns / stats.totalTurns;
      
      if (failureRate > 0.7) {
        const fingerprint = crypto.createHash('md5')
          .update(`${stats.model}-high_failure-${stats.topAction || 'unknown'}`)
          .digest('hex');

        failures.push({
          fingerprint,
          model: stats.model,
          status: 'high_failure_rate',
          summary: `Failed ${stats.failedTurns}/${stats.totalTurns} turns (${Math.round(failureRate * 100)}%)`,
          failedActions: stats.failedTurns,
          timestamp: new Date().toISOString()
        });
      }
    }

    return failures;
  }

  detectPatterns() {
    const sessionFailures = this.ingestSessions();
    const logFailures = this.ingestSessionLog();
    
    const allFailures = [...sessionFailures, ...logFailures];
    const patterns = {};

    for (const failure of allFailures) {
      if (!patterns[failure.fingerprint]) {
        patterns[failure.fingerprint] = {
          ...failure,
          count: 0,
          recent: []
        };
      }
      patterns[failure.fingerprint].count++;
      patterns[failure.fingerprint].recent.push(failure.timestamp);
    }

    return Object.values(patterns)
      .sort((a, b) => b.count - a.count);
  }

  propagate() {
    const patterns = this.detectPatterns();
    const marketplace = new this.mp();
    let posted = 0;

    for (const pattern of patterns) {
      if (pattern.count >= 2) {
        const problem = {
          title: `Failure Pattern: ${pattern.model} ${pattern.status} (${pattern.count}x)`,
          description: `Detected ${pattern.count} similar failures in 72h. Model: ${pattern.model}, Status: ${pattern.status}, Failed Actions: ${pattern.failedActions}, Summary: ${pattern.summary}`,
          domain: 'failure-analysis',
          difficulty: pattern.count > 5 ? 'high' : 'medium',
          postedBy: 'failure-propagator'
        };

        try {
          marketplace.postProblem(problem);
          posted++;
        } catch (e) {
          console.error(`Failed to post problem: ${e.message}`);
        }
      }
    }

    return posted;
  }

  snapshot() {
    const patterns = this.detectPatterns();
    const totalFailures = patterns.reduce((sum, p) => sum + p.count, 0);
    
    return {
      timestamp: new Date().toISOString(),
      totalPatterns: patterns.length,
      totalFailures,
      topPatterns: patterns.slice(0, 5).map(p => ({
        fingerprint: p.fingerprint.substring(0, 8),
        model: p.model,
        status: p.status,
        count: p.count,
        summary: p.summary.substring(0, 60)
      }))
    };
  }
}

if (require.main === module) {
  const propagator = new FailurePropagator();
  const args = process.argv.slice(2);

  if (args.includes('--scan')) {
    const patterns = propagator.detectPatterns();
    console.log(`Found ${patterns.length} failure patterns`);
    patterns.slice(0, 5).forEach(p => {
      console.log(`${p.fingerprint.substring(0, 8)}: ${p.model} ${p.status} (${p.count}x)`);
    });
  } else if (args.includes('--propagate')) {
    const posted = propagator.propagate();
    console.log(`Posted ${posted} problems to marketplace`);
  } else if (args.includes('--snapshot')) {
    console.log(JSON.stringify(propagator.snapshot(), null, 2));
  } else if (args.includes('--json')) {
    console.log(JSON.stringify(propagator.detectPatterns(), null, 2));
  } else {
    console.log('Usage: node city-col-propagate.js [--scan|--propagate|--snapshot|--json]');
  }
}

module.exports = FailurePropagator;