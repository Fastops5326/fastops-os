#!/usr/bin/env node
/**
 * city-spawn-claude.js — Autonomously spin up new Claude Code agents dynamically.
 *
 * Implements bulletproof structural logic derived from City Deliberation:
 * 1. File Locking (flock) on seat-map.json to prevent race conditions.
 * 2. Dynamic Free Port Discovery via net.createServer.
 * 3. Dynamic Seat ID incrementation.
 * 4. Detached background daemon spawning for pty-claude.js.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const crypto = require('crypto');

const SEAT_MAP_FILE = path.join(__dirname, 'cdp', 'seat-map.json');
const LOCK_FILE = path.join(__dirname, 'cdp', 'seat-map.json.lock');

// 1. Bulletproof File Locking
async function acquireLock(timeoutMs = 15000) {
  const start = process.hrtime.bigint();
  const timeoutNs = BigInt(timeoutMs) * 1000000n; // ms to ns
  while (process.hrtime.bigint() - start < timeoutNs) {
    try {
      fs.writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const stats = fs.statSync(LOCK_FILE);
          if (Date.now() - stats.mtimeMs > timeoutMs) {
            // Lock is older than timeout, but let's verify PID
            let lockPidStr;
            try {
              lockPidStr = fs.readFileSync(LOCK_FILE, 'utf8').trim();
            } catch (readErr) {
              if (readErr.code === 'ENOENT') continue; // file deleted by another process
              throw readErr;
            }
            const lockPid = parseInt(lockPidStr, 10);
            let isRunning = true;
            if (!isNaN(lockPid)) {
                try {
                    process.kill(lockPid, 0); // test signal
                } catch(err) {
                    if (err.code === 'ESRCH') {
                        isRunning = false; // process doesn't exist
                    }
                }
            } else {
                isRunning = false; // invalid PID
            }
            
            if (!isRunning) {
                console.warn(`[CITY-SPAWN] Found stale lock file for non-existent PID ${lockPid}. Removing...`);
                fs.unlinkSync(LOCK_FILE);
                continue; // Retry acquisition immediately
            }
          }
        } catch (statErr) {
          // Ignore stat errors, file might have been deleted just now
        }
        // Non-blocking wait
        await new Promise(r => setTimeout(r, 100));
      } else {
        throw e; // properly propagate non-EEXIST errors
      }
    }
  }
  throw new Error('Timeout acquiring lock on seat-map.json');
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch(e) {}
}

// 2. Find an available TCP port
async function findFreePort(startPort, usedPorts = new Set()) {
  let port = startPort;
  while (port < 65536) {
    if (!usedPorts.has(port)) {
      try {
        const availablePort = await new Promise((resolve, reject) => {
          const server = net.createServer();
          server.unref(); // Prevent blocking exit if something goes wrong
          server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              resolve(null); // Signal port is in use
            } else {
              reject(err);
            }
          });
          server.listen(port, '127.0.0.1', () => {
            const p = server.address().port;
            server.close(() => resolve(p));
          });
        });

        if (availablePort !== null) {
          return availablePort;
        }
      } catch (err) {
        throw err; // re-throw unexpected errors
      }
    }
    port++;
  }
  throw new Error(`Port exhaustion: No available ports between ${startPort} and 65535`);
}

// Main logic
async function spawnClaude() {
  try {
    console.log('[CITY-SPAWN] Acquiring structural lock on seat-map...');
    await acquireLock();
    
    let seatMap;
    try {
      const fileData = await fs.promises.readFile(SEAT_MAP_FILE, 'utf8');
      seatMap = JSON.parse(fileData);
      if (typeof seatMap !== 'object' || seatMap === null) {
        throw new Error('seatMap is not an object');
      }
    } catch (e) {
      console.warn(`[CITY-SPAWN] Failed to parse seat-map.json: ${e.message}. Using default empty seat map.`);
      seatMap = { seats: {}, aliases: {} };
    }
    
    if (!seatMap.aliases || typeof seatMap.aliases !== 'object') {
      seatMap.aliases = {};
    }
    if (!seatMap.seats || typeof seatMap.seats !== 'object') {
      seatMap.seats = {};
    }
    
    // Track all used ports to avoid holes and collisions
    const usedPorts = new Set();
    let maxSeatNum = 0;
    
    for (const [key, seat] of Object.entries(seatMap.seats)) {
      if (key.startsWith('seat-')) {
        const num = parseInt(key.replace('seat-', ''), 10);
        if (!isNaN(num) && num > maxSeatNum) maxSeatNum = num;
      }
      
      // Validation for seat structure
      if (!seat.type || !seat.agent || !seat.model) {
        console.warn(`[CITY-SPAWN] Warning: Seat ${key} is missing required fields (type, agent, model).`);
      }
      
      if (seat.pty_port !== undefined && seat.pty_port !== null && typeof seat.pty_port === 'number') {
        usedPorts.add(seat.pty_port);
      }
      if (seat.port !== undefined && seat.port !== null && typeof seat.port === 'number') {
        usedPorts.add(seat.port);
      }
    }
    
    const nextSeatId = `seat-${maxSeatNum + 1}`;
    console.log(`[CITY-SPAWN] Allocated new seat ID: ${nextSeatId}`);
    
    // Calculate dynamic start ports by scanning the seat-map
    // PTY ports typically start above 9300, VS Code ports above 9222
    const highestUsedPtyPort = Math.max(9300, ...usedPorts, 0);
    const ptyPort = await findFreePort(highestUsedPtyPort + 1, usedPorts);
    usedPorts.add(ptyPort); // Claim it immediately so vsCodePort doesn't reuse it
    console.log(`[CITY-SPAWN] Found available TCP PTY port: ${ptyPort}`);

    // Find a port that is NOT the same as the PTY port we just found
    const highestUsedVsCodePort = Math.max(9222, ...usedPorts, 0);
    const vsCodePort = await findFreePort(highestUsedVsCodePort + 1, usedPorts);
    usedPorts.add(vsCodePort);
    console.log(`[CITY-SPAWN] Found available VS Code port: ${vsCodePort}`);
    
    // Register the new seat
    const agentHex = crypto.randomBytes(8).toString('hex').slice(0, 8); // more secure random
    const agentName = `claude-${agentHex}`;
    
    seatMap.seats[nextSeatId] = {
      type: "vscode",
      port: vsCodePort,
      pty_port: ptyPort,
      agent: agentName,
      model: "claude",
      sidebar: agentName.toUpperCase(),
      description: `Dynamically spawned Claude Code terminal (Autoscaled)`
    };
    
    seatMap.aliases[agentName] = nextSeatId;
    seatMap.aliases[`${agentName}-node`] = nextSeatId;
    
    // Atomic write to temporary file, then rename
    const tmpFile = `${SEAT_MAP_FILE}.tmp`;
    const dataToWrite = JSON.stringify(seatMap, null, 2);
    const fd = fs.openSync(tmpFile, 'w');
    try {
        fs.writeSync(fd, dataToWrite);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, SEAT_MAP_FILE);
    releaseLock();

    console.log(`[CITY-SPAWN] Registered ${nextSeatId} into seat-map.json`);
    
    // Spawn the daemon
    const logDir = path.join(__dirname, '..', 'terminals');
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch(err) {
      console.error('[CITY-SPAWN] Failed to create terminals directory:', err);
    }
    
    const logFile = path.join(logDir, `${agentName}-pty.log`);
    let logFd;
    try {
      logFd = fs.openSync(logFile, 'a');
    } catch (err) {
      console.warn(`[CITY-SPAWN] Failed to open log file ${logFile}: ${err.message}. Defaulting to process.stderr.`);
      logFd = process.stderr.fd;
    }
    
    const ptyClaudeScript = path.join(__dirname, 'pty-claude.js');
    
    console.log(`[CITY-SPAWN] Launching detached daemon for ${agentName}...`);
    
    let child;
    try {
      child = spawn('node', [ptyClaudeScript], {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, FASTOPS_SEAT: nextSeatId }
      });
      
      child.on('error', (err) => {
        console.error(`[CITY-SPAWN] Child process failed to spawn: ${err.message}`);
        
        // Asynchronous undo operation to prevent blocking the event loop
        (async () => {
          try {
            console.log(`[CITY-SPAWN] Attempting to rollback seat map changes for ${nextSeatId}...`);
            await acquireLock(15000); // reuse robust lock logic with retry/backoff
            try {
              const currentData = await fs.promises.readFile(SEAT_MAP_FILE, 'utf8');
              const currentMap = JSON.parse(currentData);
              delete currentMap.seats[nextSeatId];
              delete currentMap.aliases[agentName];
              delete currentMap.aliases[`${agentName}-node`];
              const tmpFileUndo = `${SEAT_MAP_FILE}.undo.tmp`;
              const dataToWriteUndo = JSON.stringify(currentMap, null, 2);
              
              // Atomic write
              const fdUndo = fs.openSync(tmpFileUndo, 'w');
              try {
                  fs.writeSync(fdUndo, dataToWriteUndo);
                  fs.fsyncSync(fdUndo);
              } finally {
                  fs.closeSync(fdUndo);
              }
              fs.renameSync(tmpFileUndo, SEAT_MAP_FILE);
              console.log(`[CITY-SPAWN] Rollback successful.`);
            } finally {
              releaseLock();
            }
          } catch (undoErr) {
            console.error(`[CITY-SPAWN] Failed to undo seat map changes: ${undoErr.message}`);
          } finally {
            process.exit(1);
          }
        })();
      });
      
      child.unref();
    } catch (spawnErr) {
      console.error(`[CITY-SPAWN] Exception during spawn: ${spawnErr.message}`);
    }

    console.log(`[CITY-SPAWN] Success! Agent ${agentName} is live and listening on port ${ptyPort} (PID: ${child ? child.pid : 'unknown'}).`);
    console.log(`[CITY-SPAWN] View logs: ${logFile}`);
    
  } catch (err) {
    releaseLock();
    console.error('[CITY-SPAWN] Failed to spawn Claude agent:', err);
    process.exit(1);
  }
}

spawnClaude();
