const { copyFileSync } = require('node:fs');
const path = require('node:path');
copyFileSync(path.join(__dirname, '../mock/seed.json'), path.join(__dirname, '../db.json'));
console.log('db.json restored. Restart the mock API if it was running.');
