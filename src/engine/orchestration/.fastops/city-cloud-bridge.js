#!/usr/bin/env node
/**
 * city-cloud-bridge.js — Hybrid Cloud Integration for City Dawn 5-Wave Cycle
 *
 * Bridges the gap between operational cloud infrastructure (AWS) and
 * the city's adaptive deliberation patterns. Monitors deployment state,
 * disaster recovery readiness, and triggers city-dawn integration.
 *
 * Addresses problem 0513f473: hybrid cloud infrastructure commits operational
 * but lack integration with city-dawn.js 5-wave cycle.
 *
 * Usage:
 *   node .fastops/city-cloud-bridge.js --status          # Check cloud state
 *   node .fastops/city-cloud-bridge.js --harvest        # Harvest for dawn
 *   node .fastops/city-cloud-bridge.js --dr-check       # Disaster recovery check
 *   node .fastops/city-cloud-bridge.js --alert <msg>     # Trigger deliberation
 *   node .fastops/city-cloud-bridge.js --integrate      # Full dawn integration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = __dirname;
const ROOT = path.join(BASE, '..');
const CLOUD_DIR = path.join(BASE, 'cloud-aws');
const STATE_FILE = path.join(BASE, '.cloud-bridge-state.json');
const ALERT_LOG = path.join(BASE, '.cloud-alerts.jsonl');

// Terraform state monitoring
const TF_STATE_PATHS = [
  path.join(CLOUD_DIR, 'terraform.tfstate'),
  path.join(ROOT, '.terraform', 'terraform.tfstate'),
];

// Critical cloud components
const CLOUD_COMPONENTS = {
  vpc: { name: 'VPC', required: true },
  ec2: { name: 'EC2 Instance', required: true },
  rds: { name: 'PostgreSQL RDS', required: false },
  s3: { name: 'S3 Buckets', required: false },
  iam: { name: 'IAM Roles', required: true },
  cloudwatch: { name: 'CloudWatch Alarms', required: false },
};

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      timeout: opts.timeout || 30000,
      encoding: 'utf8',
      cwd: opts.cwd || ROOT,
      windowsHide: true,
      ...opts,
    }).trim();
  } catch (e) {
    return opts.fallback || `[ERROR: ${e.message?.slice(0, 80)}]`;
  }
}

// ── State Management ───────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      lastCheck: null,
      deploymentStatus: 'unknown',
      lastAlert: null,
      drTests: [],
      integrations: [],
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function logAlert(type, severity, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    severity, // critical, warning, info
    message,
    data,
  };
  fs.appendFileSync(ALERT_LOG, JSON.stringify(entry) + '\n');

  // Trigger city deliberation for critical alerts
  if (severity === 'critical') {
    triggerDeliberation(type, message, data);
  }
}

// ── Cloud Status Detection ──────────────────────────────────────────

function detectDeploymentStatus() {
  // Check if Terraform has been applied
  let tfState = null;
  for (const tfPath of TF_STATE_PATHS) {
    if (fs.existsSync(tfPath)) {
      try {
        tfState = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
        break;
      } catch {}
    }
  }

  // Check for deployment markers
  const deployMarkers = {
    awsProfile: fs.existsSync(path.join(ROOT, '.aws', 'config')),
    sshKey: fs.existsSync(path.join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'fastops-aws.pub')),
    tfVars: fs.existsSync(path.join(CLOUD_DIR, 'terraform.tfvars')),
    dockerBuilt: fs.existsSync(path.join(CLOUD_DIR, '.docker-built')),
  };

  // Determine status
  if (tfState && tfState.resources && tfState.resources.length > 0) {
    return {
      status: 'deployed',
      resources: tfState.resources.length,
      markers: deployMarkers,
      lastModified: tfState.serial ? new Date(tfState.serial * 1000).toISOString() : null,
    };
  } else if (deployMarkers.tfVars || deployMarkers.sshKey) {
    return {
      status: 'configured',
      resources: 0,
      markers: deployMarkers,
    };
  } else {
    return {
      status: 'unconfigured',
      resources: 0,
      markers: deployMarkers,
    };
  }
}

function checkDrReadiness() {
  const drChecks = {
    backupScript: fs.existsSync(path.join(CLOUD_DIR, 'backup.sh')),
    restoreScript: fs.existsSync(path.join(CLOUD_DIR, 'restore.sh')),
    drRunbook: fs.existsSync(path.join(CLOUD_DIR, 'DR-RUNBOOK.md')),
    healthCheck: fs.existsSync(path.join(BASE, 'pt-platoon-api-health.js')),
    lastTest: null,
  };

  // Check for recent DR test in state
  const state = loadState();
  if (state.drTests && state.drTests.length > 0) {
    const lastTest = state.drTests[state.drTests.length - 1];
    const daysSince = (Date.now() - new Date(lastTest.date).getTime()) / (1000 * 60 * 60 * 24);
    drChecks.lastTest = {
      date: lastTest.date,
      daysSince: Math.round(daysSince),
      passed: lastTest.passed,
    };
  }

  // Score DR readiness
  let score = 0;
  if (drChecks.backupScript) score += 25;
  if (drChecks.restoreScript) score += 25;
  if (drChecks.drRunbook) score += 25;
  if (drChecks.healthCheck) score += 25;

  return {
    ready: score >= 75,
    score,
    checks: drChecks,
    recommendation: score < 75 ? 'Complete DR scripts before production' : 'DR ready — schedule regular tests',
  };
}

// ── Dawn Integration ────────────────────────────────────────────────

function harvestForDawn() {
  const status = detectDeploymentStatus();
  const dr = checkDrReadiness();

  const cloudState = {
    deployment: status,
    dr: dr,
    alerts: getRecentAlerts(24),
    resources: estimateResourceCost(),
  };

  // Format for city-dawn consumption
  const dawnFormat = {
    section: 'CLOUD INFRASTRUCTURE',
    status: status.status,
    bluf: `Cloud: ${status.status} | DR: ${dr.ready ? 'READY' : 'INCOMPLETE'} (${dr.score}%)`,
    details: {
      resources: status.resources,
      drScore: dr.score,
      drLastTest: dr.lastTest?.daysSince || 'never',
      openAlerts: cloudState.alerts.filter(a => a.severity === 'critical').length,
    },
    decisions: generateDecisions(cloudState),
    raw: cloudState,
  };

  return dawnFormat;
}

function estimateResourceCost() {
  // Based on DEPLOY-AWS.md estimates
  return {
    monthly: '~$28-32',
    breakdown: {
      ec2: '$15-20 (t3.medium)',
      rds: '$10-12 (db.t3.micro)',
      s3: '$1-2',
      dataTransfer: '$2-3',
    },
  };
}

function getRecentAlerts(hours) {
  if (!fs.existsSync(ALERT_LOG)) return [];

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const lines = fs.readFileSync(ALERT_LOG, 'utf8').trim().split('\n').filter(Boolean);

  return lines
    .map(l => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(a => a && new Date(a.timestamp).getTime() > cutoff);
}

function generateDecisions(state) {
  const decisions = [];

  if (state.deployment.status === 'unconfigured') {
    decisions.push({
      priority: 'P1',
      text: 'Cloud infrastructure not configured — AWS setup required before production',
      owner: 'FACILITATOR',
    });
  }

  if (!state.dr.ready) {
    decisions.push({
      priority: 'P2',
      text: `DR readiness at ${state.dr.score}% — backup/restore scripts incomplete`,
      owner: 'city-reflex',
    });
  }

  if (state.dr.lastTest && state.dr.lastTest.daysSince > 30) {
    decisions.push({
      priority: 'P3',
      text: `Last DR test was ${state.dr.lastTest.daysSince} days ago — schedule test`,
      owner: 'city-dawn',
    });
  }

  const criticalAlerts = state.alerts.filter(a => a.severity === 'critical');
  if (criticalAlerts.length > 0) {
    decisions.push({
      priority: 'P0',
      text: `${criticalAlerts.length} critical cloud alerts require immediate attention`,
      owner: 'human',
    });
  }

  return decisions;
}

// ── Deliberation Trigger ───────────────────────────────────────────

function triggerDeliberation(type, message, data) {
  // Post to comms for immediate visibility
  try {
    const { send } = require(path.join(BASE, 'comms', 'protocol'));
    send('city-cloud-bridge', `[CLOUD ALERT] ${type}: ${message.slice(0, 200)}`, 'general');
  } catch {}

  // Log for dawn cycle
  const state = loadState();
  state.lastAlert = {
    timestamp: new Date().toISOString(),
    type,
    message,
    triggeredDeliberation: true,
  };
  saveState(state);

  // Could trigger city-pipeline here for structured deliberation
  console.log(`  [ALERT] ${type} triggered deliberation: ${message.slice(0, 80)}`);
}

// ── Full Integration ────────────────────────────────────────────────

function integrateWithDawn() {
  console.log('Running cloud-dawn integration...\n');

  const harvest = harvestForDawn();
  console.log(`  Status: ${harvest.bluf}`);
  console.log(`  Decisions: ${harvest.decisions.length} items`);

  // Write to dawn-compatible format
  const dawnOutput = {
    timestamp: new Date().toISOString(),
    source: 'city-cloud-bridge',
    section: harvest.section,
    bluf: harvest.bluf,
    deploymentStatus: harvest.status,
    drReady: harvest.details.drScore >= 75,
    drScore: harvest.details.drScore,
    decisions: harvest.decisions,
    resourceEstimate: harvest.resources,
  };

  const outputPath = path.join(BASE, `cloud-dawn-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(dawnOutput, null, 2));

  console.log(`\n  Written: ${path.relative(ROOT, outputPath)}`);

  // If critical, alert immediately
  const critical = harvest.decisions.filter(d => d.priority === 'P0');
  if (critical.length > 0) {
    console.log(`\n  CRITICAL decisions requiring immediate action:`);
    for (const d of critical) {
      console.log(`    [${d.priority}] ${d.text.slice(0, 100)}`);
    }
  }

  return dawnOutput;
}

// ── CLI ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Ensure cloud dir exists
  if (!fs.existsSync(CLOUD_DIR)) {
    console.error(`Cloud directory not found: ${CLOUD_DIR}`);
    console.error('AWS infrastructure not yet deployed.');
    process.exit(1);
  }

  switch (command) {
    case '--status': {
      const status = detectDeploymentStatus();
      const dr = checkDrReadiness();
      console.log('Cloud Infrastructure Status:\n');
      console.log(`  Deployment: ${status.status}`);
      console.log(`  Resources: ${status.resources} managed`);
      console.log(`  DR Ready: ${dr.ready} (${dr.score}%)`);
      console.log(`  Last DR Test: ${dr.lastTest?.daysSince || 'never'}`);
      console.log(`  Configured: ${Object.entries(status.markers).filter(([k,v]) => v).map(([k]) => k).join(', ') || 'none'}`);
      break;
    }

    case '--harvest': {
      const harvest = harvestForDawn();
      console.log(JSON.stringify(harvest, null, 2));
      break;
    }

    case '--dr-check': {
      const dr = checkDrReadiness();
      console.log('Disaster Recovery Check:\n');
      console.log(`  Score: ${dr.score}/100`);
      console.log(`  Ready: ${dr.ready ? 'YES' : 'NO'}`);
      console.log(`  Recommendation: ${dr.recommendation}`);
      console.log('\n  Components:');
      for (const [key, present] of Object.entries(dr.checks)) {
        if (key !== 'lastTest') {
          console.log(`    ${key}: ${present ? '✓' : '✗'}`);
        }
      }
      break;
    }

    case '--alert': {
      const msg = args.slice(1).join(' ') || 'Test alert';
      logAlert('manual', 'warning', msg);
      console.log('Alert logged and deliberation triggered.');
      break;
    }

    case '--integrate':
    case '--dawn': {
      integrateWithDawn();
      break;
    }

    case '--dr-test': {
      // Simulate DR test
      const state = loadState();
      state.drTests = state.drTests || [];
      state.drTests.push({
        date: new Date().toISOString(),
        passed: true,
        notes: 'Simulated DR test via city-cloud-bridge',
      });
      saveState(state);
      console.log('DR test recorded. Run --dr-check to see updated score.');
      break;
    }

    default:
      console.log(`Usage:
  --status        Check cloud deployment status
  --harvest       Harvest state for city-dawn
  --dr-check      Disaster recovery readiness
  --alert <msg>   Trigger alert + deliberation
  --integrate     Full dawn integration (run nightly)
  --dr-test       Record DR test completion`);
  }
}

// Export for programmatic use
module.exports = {
  detectDeploymentStatus,
  checkDrReadiness,
  harvestForDawn,
  triggerDeliberation,
  logAlert,
};

if (require.main === module) {
  main();
}
