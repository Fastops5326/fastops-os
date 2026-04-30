const { execSync } = require('child_process');
const fs = require('fs');

try {
  const output = execSync('node .fastops/city-boot.js', { encoding: 'utf8' });
  fs.writeFileSync('.fastops/.boot-context.txt', output);
  console.log(`Boot context updated: ${output.length} chars written`);
} catch (error) {
  console.error('Error updating boot context:', error.message);
}