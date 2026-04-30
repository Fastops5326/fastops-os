const fs = require('fs');
const path = require('path');
const dir = '.fastops/.sessions';
const now = Date.now();
const sixtyMinutesAgo = now - 3600000; // 60 minutes in ms
fs.readdirSync(dir).forEach(file => {
  if (path.extname(file) === '.json') {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > sixtyMinutesAgo) {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const ageMinutes = Math.round((now - stat.mtimeMs) / 60000);
        console.log(`${data.id} | ${data.model} | ${data.status} | ${ageMinutes}`);
      }
    } catch (err) {
      console.error(`Error processing ${file}: ${err.message}`);
    }
  }
});