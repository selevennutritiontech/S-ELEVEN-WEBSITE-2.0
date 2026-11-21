'use strict';
/* The server overwrites "who" and "role" by looking at each operation's parameter NAMES. If a later change to the data layer renames, drops or moves
   one of these parameters (for example by wrapping an operation with a shorter parameter list), the server would silently stop overwriting it
   and a browser could claim a role. This test fails if that ever happens. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Engine } = require('../src/engine.js');
const expected = require('./expected-identity-params.json');
const { PORTAL } = require('./helpers.js');
test('every operation that takes a caller identity or role still declares it, at the same position', () => {
  const e = new Engine(PORTAL, new Map(), 0), bad = [];
  for (const [fn, params] of Object.entries(expected)) { const now = e.sigs[fn]; if (!now) { bad.push(fn + ' is missing'); continue; } for (const [i, name] of Object.entries(params)) if (now[i] !== name) bad.push(fn + ': parameter ' + i + ' should be "' + name + '" but the operation is now (' + now.join(', ') + ')'); }
  assert.deepEqual(bad, [], 'identity parameters changed:\n' + bad.join('\n'));
  assert.ok(Object.keys(expected).length >= 90);
});
