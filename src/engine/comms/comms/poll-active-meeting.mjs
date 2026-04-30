/**
 * Poll active-meeting.jsonl every 12s; append one line per tick to data/meeting-poll.log
 * Usage: node comms/poll-active-meeting.mjs
 * Stop: Ctrl+C
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MFILE = path.join(__dirname, 'data', 'active-meeting.jsonl')
const LOG = path.join(__dirname, 'data', 'meeting-poll.log')
const INTERVAL_MS = 12_000

let lastCount = 0

function tick() {
  const raw = fs.existsSync(MFILE) ? fs.readFileSync(MFILE, 'utf8') : ''
  const lines = raw.trim().split('\n').filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? ''
  let lastFrom = ''
  try {
    lastFrom = JSON.parse(lastLine).from || JSON.parse(lastLine).ts || ''
  } catch {
    lastFrom = '(parse error)'
  }
  const rec = {
    ts: new Date().toISOString(),
    transcriptLines: lines.length,
    newSinceLastPoll: lines.length - lastCount,
    lastFrom,
    tail: lastLine.slice(0, 160),
  }
  lastCount = lines.length
  const out = JSON.stringify(rec) + '\n'
  fs.appendFileSync(LOG, out)
  process.stdout.write(out)
}

console.error(`[poll] ${MFILE} every ${INTERVAL_MS / 1000}s -> ${LOG} (Ctrl+C to stop)`)
tick()
setInterval(tick, INTERVAL_MS)
