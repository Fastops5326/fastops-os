const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '.compiled-state/memory-store.json');
const MAX_ENTRIES = 1000;
const TTL_DAYS = 7;

let memory = { entries: [], accessCounts: {}, lastCleanup: Date.now() };

function loadMemory() {
  if (fs.existsSync(MEMORY_FILE)) {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  }
}

function saveMemory() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^\w\s]/g, '');
}

function tfidfSearch(keyword) {
  if (memory.entries.length === 0) return [];
  
  const docs = memory.entries.map(e => 
    new Set(normalizeWord(e.detail || e.description || e.title || '').split(/\s+/))
  );
  
  const keywordNorm = normalizeWord(keyword);
  const scores = memory.entries.map((entry, i) => {
    if (docs[i].has(keywordNorm)) {
      const tf = 1;
      const df = docs.filter(d => d.has(keywordNorm)).length;
      const idf = Math.log(docs.length / df);
      return { entry, score: tf * idf, id: entry.id || i };
    }
    return { entry, score: 0, id: entry.id || i };
  });
  
  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => {
      memory.accessCounts[s.id] = (memory.accessCounts[s.id] || 0) + 1;
      return s.entry;
    });
}

function cleanup() {
  const now = Date.now();
  const ttl = TTL_DAYS * 24 * 60 * 60 * 1000;
  
  memory.entries = memory.entries.filter(e => 
    now - new Date(e.timestamp).getTime() < ttl
  );
  
  if (memory.entries.length > MAX_ENTRIES) {
    const entriesWithAccess = memory.entries.map(e => ({
      entry: e,
      id: e.id || memory.entries.indexOf(e),
      access: memory.accessCounts[e.id] || 0
    }));
    
    entriesWithAccess.sort((a, b) => a.access - b.access);
    const toRemove = entriesWithAccess.slice(0, memory.entries.length - MAX_ENTRIES);
    
    memory.entries = memory.entries.filter(e => 
      !toRemove.some(r => r.entry === e)
    );
    
    toRemove.forEach(r => delete memory.accessCounts[r.id]);
  }
  
  memory.lastCleanup = now;
}

function boot() {
  // Load city ledger
  const ledgerPath = path.join(__dirname, 'city-ledger.jsonl');
  if (fs.existsSync(ledgerPath)) {
    const ledger = fs.readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    memory.entries.push(...ledger);
  }
  
  // Load handoff draft
  const handoffPath = path.join(__dirname, '.handoff-draft.md');
  if (fs.existsSync(handoffPath)) {
    const content = fs.readFileSync(handoffPath, 'utf8');
    const sections = content.split(/---|\n##\s+/).filter(s => s.trim());
    const recent = sections.slice(-5);
    
    recent.forEach((section, i) => {
      memory.entries.push({
        id: `handoff-${Date.now()}-${i}`,
        timestamp: new Date().toISOString(),
        type: 'handoff',
        content: section.trim()
      });
    });
  }
  
  // Load marketplace problems
  const problemsPath = path.join(__dirname, 'marketplace/problems.jsonl');
  if (fs.existsSync(problemsPath)) {
    const problems = fs.readFileSync(problemsPath, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    memory.entries.push(...problems);
  }
  
  cleanup();
  saveMemory();
  
  console.log(`Boot complete: ${memory.entries.length} entries loaded`);
}

function recent(N) {
  return memory.entries
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, N);
}

function query(keyword) {
  return tfidfSearch(keyword);
}

// CLI
const args = process.argv.slice(2);
const mode = args[0];

loadMemory();

if (mode === '--boot') {
  boot();
} else if (mode === '--query') {
  const results = query(args[1]);
  console.log(JSON.stringify(results, null, 2));
} else if (mode === '--recent') {
  const results = recent(parseInt(args[1]) || 10);
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('Usage: node city-memory.js [--boot|--query keyword|--recent N]');
}