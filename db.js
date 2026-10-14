const fs = require('fs');
const path = require('path');
const dataFile = path.join(__dirname, 'backtests.json');

function ensureFile() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([]), 'utf8');
  }
}

ensureFile();

function saveBacktest(result, cb) {
  const records = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const id = records.length ? records[records.length - 1].id + 1 : 1;
  const record = { id, ...result, createdAt: new Date().toISOString() };
  records.push(record);
  fs.writeFileSync(dataFile, JSON.stringify(records, null, 2), 'utf8');
  if (cb) cb(null, id);
}

function listBacktests(limit = 20, cb) {
  const records = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const slice = records.slice(-limit).reverse();
  if (cb) cb(null, slice);
}

function getBacktest(id, cb) {
  const records = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const rec = records.find(r => r.id === Number(id));
  if (cb) cb(null, rec);
}

module.exports = { saveBacktest, listBacktests, getBacktest };
