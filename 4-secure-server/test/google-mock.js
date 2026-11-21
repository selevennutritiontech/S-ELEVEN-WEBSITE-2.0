'use strict';
/* A stand-in for Google: runs the REAL Code.gs (the Apps Script) against in-memory Sheets/Drive objects, behind a local web address that
   behaves like Google's (POST answers with a 302 redirect to the result). Sheets must be "shared" with the script's account or openById fails. */
const http = require('node:http');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const CODE = fs.readFileSync(path.resolve(__dirname, '..', '..', '2-operations-platform-core', 'google-sheets', 'Code.gs'), 'utf8');

function makeGoogle(opts = {}) {
  const st = { secret: opts.secret || 'right-secret', sheets: new Map(), shared: new Set(), seq: 0, calls: 0, lastItems: [] };
  class Sheet { constructor(n) { this.name = n; this.rows = []; } getLastRow() { return this.rows.length; } getName() { return this.name; } setName(n) { this.name = n; } setFrozenRows() {} appendRow(r) { this.rows.push(r.slice()); }
    getRange(r, c, nr, nc) { const sh = this; return { getValues() { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]))); } return out; }, setValues(v) { v.forEach((row, i) => { const tgt = sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((x, j) => { tgt[c - 1 + j] = x; }); }); return this; }, setFontWeight() { return this; }, setBackground() { return this; } }; } }
  class Spread { constructor(id, name) { this.id = id; this.name = name; this.tabs = [new Sheet('Sheet1')]; } getId() { return this.id; } getSheetByName(n) { return this.tabs.find(t => t.name === n) || null; } insertSheet(n) { const s = new Sheet(n); this.tabs.push(s); return s; } getSheets() { return this.tabs; } }
  const mk = (id, name, shared) => { const s = new Spread(id, name); st.sheets.set(id, s); if (shared) st.shared.add(id); return s; };
  const folderFiles = new Map(); const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => st.secret }) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) }, MimeType: { GOOGLE_SHEETS: 'sheets' },
    SpreadsheetApp: { openById: id => { if (!st.sheets.has(id) || !st.shared.has(id)) throw new Error('Exception: You do not have permission to access the requested document.'); return st.sheets.get(id); }, create: n => mk('NEW' + (++st.seq), n, true), open: f => f.ss },
    DriveApp: { getFoldersByName: () => iter([{ getFilesByName: n => iter(folderFiles.has(n) ? [folderFiles.get(n)] : []), addFile: f => { folderFiles.set(f.name, f); } }]), createFolder: () => ({ getFilesByName: n => iter(folderFiles.has(n) ? [folderFiles.get(n)] : []), addFile: f => { folderFiles.set(f.name, f); } }), getFileById: id => ({ ss: st.sheets.get(id), name: st.sheets.get(id).name, getMimeType: () => 'sheets' }), getRootFolder: () => ({ removeFile() {} }) },
  };
  vm.createContext(sandbox); vm.runInContext(CODE, sandbox);
  const results = new Map(); let rid = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { st.calls++; let out; try { const d = JSON.parse(b); st.lastItems = d.items || []; } catch (e) {} out = sandbox.doPost({ postData: { contents: b } }).text; const id = ++rid; results.set(id, out); res.writeHead(302, { Location: '/echo/' + id }); res.end(); }); }
    else if (req.url.startsWith('/echo/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(results.get(+req.url.split('/')[2]) || '{}'); } else { res.writeHead(200); res.end('{"ok":true}'); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ st, url: 'http://127.0.0.1:' + server.address().port + '/macros/s/TEST/exec', pattern: /^http:\/\/127\.0\.0\.1:\d+\/macros\/s\/TEST\/exec$/, mk, folderFiles, close: () => new Promise(x => server.close(x)) })));
}
module.exports = { makeGoogle };
