/**
 * S-ELEVEN Nutrition: receives rows from the portal and writes them into Google Sheets.
 *
 * What it does
 *  - If a department linked its own Google Sheet in the portal, its rows are written into THAT sheet (the sheet must be shared with the Google account that owns this script, as Editor).
 *  - Otherwise one Google Sheets file per workbook the portal sends (for example "Sales sheets", "Finance sheets",
 *    "Logistics sheets", "Warehouse sheets", "Company (Host) sheets", "My sheets: SALES").
 *  - One tab per sheet (Orders, Payments, Invoices, Shipments, To pack, Activity ...). Tabs and the header row
 *    are created automatically.
 *  - Rows are UPDATED when the key (first column, e.g. the Order ID) already exists, otherwise appended.
 *    Activity rows have no key and are always appended.
 *
 * Setup (about 5 minutes) is in README.md next to this file.
 */

var FOLDER_NAME = 'S-ELEVEN Sheets';       // Drive folder that holds the files (created if missing)
var MAX_ITEMS = 200;                        // safety limit per request

function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) { out.error = 'Wrong secret'; return json_(out); }
    var items = (body.items || []).slice(0, MAX_ITEMS);
    var lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var written = 0, errors = [];
      items.forEach(function (it) {
        try { if (writeItem_(it)) written++; }
        catch (err) { errors.push({ book: it && it.book, tab: it && it.tab, error: String(err).slice(0, 160) }); }   // e.g. the sheet was not shared with this account
      });
      out.ok = true; out.written = written; if (errors.length) out.errors = errors;
    } finally { lock.releaseLock(); }
  } catch (err) { out.error = String(err); }
  return json_(out);
}

function doGet() { return json_({ ok: true, service: 'S-ELEVEN sheets receiver' }); }

function writeItem_(it) {
  if (!it || !it.book || !it.tab || !it.row) return false;
  // a department that linked its OWN Google Sheet sends its sheet id as "target": write there. Otherwise use a file named after the workbook.
  var ss = it.target ? SpreadsheetApp.openById(String(it.target)) : book_(String(it.book).slice(0, 90));
  var sh = ss.getSheetByName(String(it.tab).slice(0, 90)) || ss.insertSheet(String(it.tab).slice(0, 90));
  var headers = it.headers || [];
  if (sh.getLastRow() === 0 && headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers.map(function (h) { return /^[=+@]/.test(String(h)) ? "'" + h : h; })]).setFontWeight('bold').setBackground('#eef2ff');
    sh.setFrozenRows(1);
  }
  // text that starts with = + @ (or - and is not a number) would be run as a FORMULA by Google Sheets: keep it as text
  function safe_(v) { if (typeof v !== 'string') return v; if (/^'/.test(v)) return v; return (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && isNaN(Number(v)))) ? "'" + v : v; }
  var row = it.row.map(function (v) { return safe_(v === null || v === undefined ? '' : v); });
  var key = String(it.key || '');
  var at = -1;
  if (key && sh.getLastRow() > 1) {
    var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) { if (String(keys[i][0]) === key) { at = i + 2; break; } }
  }
  if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  return true;
}

function book_(name) {
  var folder = folder_();
  var files = folder.getFilesByName(name);
  while (files.hasNext()) { var f = files.next(); if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.open(f); }
  var ss = SpreadsheetApp.create(name);
  var file = DriveApp.getFileById(ss.getId());
  folder.addFile(file); DriveApp.getRootFolder().removeFile(file);
  var first = ss.getSheets()[0]; if (first && first.getName() === 'Sheet1' && ss.getSheets().length === 1) first.setName('Sheet1');
  return ss;
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

/** Run this ONCE from the Apps Script editor: it stores your secret. Change the text below first. */
function setSecret() {
  PropertiesService.getScriptProperties().setProperty('SECRET', 'CHANGE-THIS-TO-A-LONG-RANDOM-TEXT');
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
