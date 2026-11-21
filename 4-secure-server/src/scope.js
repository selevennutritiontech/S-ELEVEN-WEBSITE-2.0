'use strict';
/* What each signed-in person may receive. The browser only ever gets this filtered copy:
   no passwords, nobody else's dealer data, only the orders a department is allowed to see. Unknown data is Host-only (deny by default). */
const { PFX } = require('./engine.js');
const INV_ROLES = new Set(['admin', 'finance', 'logistics', 'warehouse', 'employee']);      // inventory screens
const OPS_ROLES = new Set(['admin', 'employee', 'finance', 'logistics', 'warehouse']);     // orders, returns, preorders
const NEVER = /^(seeded|ops\d*|keepdemo|cleanid|busy|epoch|stgseen|stgbase|dlseq|invseq|retseq|rcseq|noteseq|fcodeseq)$/;
const ALL = new Set(['cbrands', 'boff', 'bover', 'couriers', 'fslabs', 'fexcl', 'inv', 'inactive', 'weights', 'freight']);
const STAFF_ALL = new Set(['holidays', 'leavepolicy', 'salpolicy', 'petrolrate', 'shiftlog', 'shift', 'incpol', 'incpolv', 'incappr', 'news']);

function isStaff(s) { return s.kind === 'staff'; }
const isField = s => s.kind === 'staff' && s.dept === 'fieldsales';
const ownDealers = (engine, s) => new Set((engine.get('dealers') || []).filter(d => d.salesEmp === s.code).map(d => d.code));
function projectBatches(b) { const o = {}; for (const k of Object.keys(b || {})) o[k] = (b[k] || []).map(x => ({ no: x.no, qty: x.qty, dmg: x.dmg, ret: x.ret, qq: x.qq, q: x.q, exp: x.exp, flavour: x.flavour })); return o; }
function byEmp(obj, s, wide) { if (wide) return obj; const o = {}; if (obj && obj[s.code] !== undefined) o[s.code] = obj[s.code]; return o; }
function rowsByEmp(arr, s, wide) { return wide ? arr : (arr || []).filter(r => r && r.emp === s.code); }
function toMe(row, s) { const a = row && row.audience, t = row && row.to; if (Array.isArray(a)) return a.includes(s.role) || a.includes('*'); if (t) return (Array.isArray(t.users) && t.users.includes(s.code)) || (Array.isArray(t.roles) && t.roles.includes(s.role)); return false; }

/* returns the JSON text this person may see for one stored key, or null for nothing */
function scoped(engine, s, name, raw) {
  if (NEVER.test(name)) return null;
  const staff = isStaff(s), host = staff && s.dept === 'host', adm = staff && s.role === 'admin', fin = staff && s.role === 'finance', role = s.role;
  let v; try { v = JSON.parse(raw); } catch (e) { return null; }
  if (name.startsWith('orders.')) {
    const code = name.slice(7);
    if (!staff) return code === s.code ? raw : null;
    if (!OPS_ROLES.has(role)) return null;
    if (isField(s) && !ownDealers(engine, s).has(code)) return null;      // a field consultant sees only their own dealers' orders
    if (role === 'warehouse') return JSON.stringify(engine.maskOrders('warehouse', engine.filterOrders(role, v)));   // the Warehouse never receives payment details
    return JSON.stringify(role === 'employee' || role === 'admin' ? v : engine.filterOrders(role, v));
  }
  if (staff && isField(s) && (name === 'inv' || name === 'batches')) {   // a consultant sees stock only of the brands the Host/senior activated for them
    const me = (engine.get('employees') || []).find(e => e.id === s.code) || {}, act = new Set(Object.keys(me.fieldBrands || {}).filter(b => me.fieldBrands[b] && me.fieldBrands[b].on)), SEL = engine.ctx.SEL;
    const keep = sku => { try { const f = SEL.findProduct(String(sku).split('|')[0]); return !!f && act.has(f.brand); } catch (e) { return false; } };
    const src = name === 'batches' ? JSON.parse(JSON.stringify(projectBatches(v))) : (v || {}), out = {}; for (const k of Object.keys(src)) if (keep(k)) out[k] = src[k]; return JSON.stringify(out);
  }
  if (ALL.has(name)) return raw;
  if (STAFF_ALL.has(name)) return staff ? raw : null;
  switch (name) {
    case 'dealers': {
      if (!staff) return JSON.stringify((v || []).filter(d => d.code === s.code));
      if (isField(s)) return JSON.stringify((v || []).filter(d => d.salesEmp === s.code));
      const prices = adm || role === 'employee' || fin; return JSON.stringify((v || []).map(d => { if (prices) return d; const o = Object.assign({}, d); delete o.prices; return o; }));
    }
    case 'employees': {
      if (isField(s)) return JSON.stringify((v || []).map(e => e.id === s.code ? e : Object.assign({}, e, { fieldBrands: undefined })));   // other consultants' commission rates are not shared
      if (staff) return raw;
      return null;   // a dealer receives no employee information at all: no name, no mobile, no ID
    }
    case 'offers': { if (staff && isField(s)) { const me = (engine.get('employees') || []).find(e => e.id === s.code), hosts = new Set((engine.get('employees') || []).filter(e => e.dept === 'host').map(e => e.id)); return JSON.stringify((v || []).filter(o => !o.createdBy || (me && o.createdBy === me.manager) || hosts.has(o.createdBy))); } if (staff) return raw; const me = (engine.get('dealers') || []).find(d => d.code === s.code), cat = me && me.category; return JSON.stringify((v || []).filter(o => !o.visibleTo || o.visibleTo === 'All' || o.visibleTo === cat)); }   // a dealer receives only the offers made visible to their category
    case 'exemps': case 'activity': return adm ? raw : null;
    case 'dledger': case 'fwallet': { if (isField(s)) { const own = ownDealers(engine, s), o = {}; for (const k of Object.keys(v || {})) if (own.has(k)) o[k] = v[k]; return JSON.stringify(o); } if (!staff) { const o = {}; if (v && v[s.code] !== undefined) o[s.code] = v[s.code]; return JSON.stringify(o); } return (adm || fin || role === 'employee') ? raw : null; }
    case 'ledger': case 'targets': return staff ? JSON.stringify(rowsByEmp(v, s, adm || fin)) : null;
    case 'preorders': case 'returns': { if (!staff) return JSON.stringify((v || []).filter(r => r.dealer === s.code)); if (isField(s)) { const own = ownDealers(engine, s); return JSON.stringify((v || []).filter(r => own.has(r.dealer))); } return OPS_ROLES.has(role) ? raw : null; }
    case 'samples': return staff && OPS_ROLES.has(role) ? raw : null;
    case 'freebies': { if (staff) return raw; return JSON.stringify((v || []).filter(f => f.active !== false && (!Array.isArray(f.dealers) || !f.dealers.length || f.dealers.includes(s.code))).map(f => { const o = Object.assign({}, f); delete o.createdBy; return o; })); }
    case 'batches': { if (!staff || isField(s)) return JSON.stringify(projectBatches(v)); return INV_ROLES.has(role) ? raw : null; }
    case 'invreq': case 'invlog': case 'samplestock': case 'purchases': return staff && INV_ROLES.has(role) ? raw : null;
    case 'lrates': return staff && (adm || role === 'logistics' || fin) ? raw : null;
    case 'allow': case 'leaves': case 'attcorr': case 'slips': return staff ? JSON.stringify(rowsByEmp(v, s, adm || fin)) : null;
    case 'att': case 'salary': return staff ? JSON.stringify(byEmp(v, s, adm || fin)) : null;
    case 'crm': { if (!staff) return null; if (s.dept === 'host') return raw; if (s.dept === 'fieldsales') return JSON.stringify((v || []).filter(r => r.owner === s.code)); if (s.dept === 'sales') { const mine = new Set((engine.get('employees') || []).filter(e => e.manager === s.code).map(e => e.id)); return JSON.stringify((v || []).filter(r => r.owner === s.code || mine.has(r.owner))); } return null; }   // the owner's leads; a Sales executive also sees their consultants' leads   // leads: the owner's own (Sales), everything (Host)
    case 'fcomm': { if (!staff) return null; if (adm && s.dept === 'host' || fin) return raw; if (isField(s)) return JSON.stringify((v || []).filter(r => r.emp === s.code)); if (s.dept === 'sales') { const mine = new Set((engine.get('employees') || []).filter(e => e.manager === s.code).map(e => e.id)); return JSON.stringify((v || []).filter(r => mine.has(r.emp))); } return null; }
    case 'visits': { if (!staff) return null; if (adm && s.dept === 'host') return raw; if (isField(s)) return JSON.stringify((v || []).filter(r => r.emp === s.code)); if (s.dept === 'sales') { const mine = new Set((engine.get('employees') || []).filter(e => e.manager === s.code).map(e => e.id)); return JSON.stringify((v || []).filter(r => mine[r.emp] || mine.has(r.emp))); } return null; }
    case 'posts': { if (staff) return raw; return JSON.stringify((v || []).map(p => { const L = Array.isArray(p.likes) ? p.likes : [], mine = L.includes(s.code); return Object.assign({}, p, { likes: (mine ? [s.code] : []).concat(new Array(Math.max(0, L.length - (mine ? 1 : 0))).fill('~')) }); })); }   // a dealer sees how many liked a post, and whether they did: never who
    case 'btasks': return staff && (adm || role === 'branding' || role === 'it') ? raw : null;
    case 'staffnotifs': case 'alerts': return staff ? JSON.stringify((v || []).filter(r => toMe(r, s))) : null;
    default: return host ? raw : null;        // anything not listed is Host-only
  }
}
function cacheKey(s) { return s.kind === 'dealer' ? 'D:' + s.code : 'S:' + s.role + ':' + s.dept + ':' + s.code; }
const cache = new Map();
/* everything this person may see that changed after version `since` */
/* A dealer never receives a staff member's real user ID (half of a login): every staff ID inside what a dealer is sent is replaced by an opaque alias, the same alias everywhere, so the dealer screens still match a dealer to their contact person. */
let aliasCache = { ver: -1, re: null };
function aliasStaff(engine, out) {
  if (typeof out !== 'string' || !engine.aliasId) return out; const ver = engine.ver.get(PFX + 'employees') || 0;
  if (aliasCache.ver !== ver) { const ids = (engine.get('employees') || []).map(e => e.id).filter(Boolean); aliasCache = { ver, re: ids.length ? new RegExp('"(' + ids.map(i => String(i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')"', 'g') : null }; }
  return aliasCache.re ? out.replace(aliasCache.re, (m, id) => '"' + engine.aliasId(id) + '"') : out;
}
function snapshot(engine, s, since) {
  const set = {}, del = []; const ck = cacheKey(s);
  for (const [k, raw] of engine.state) {
    if (!k.startsWith(PFX)) continue; let ver = engine.ver.get(k) || 0; if (k === PFX + 'offers' || (isField(s) && /^sel\.v2\.(orders\.|returns$|preorders$|dledger$|fwallet$)/.test(k))) ver = Math.max(ver, engine.ver.get(PFX + 'dealers') || 0); if (ver <= since) continue;   // offers depend on the dealer's category, so they are re-sent when dealers change
    const name = k.slice(PFX.length), ckey = ck + '|' + name + '|' + ver; let out = (name === 'offers' || isField(s)) ? undefined : cache.get(ckey);
    if (out === undefined) { try { out = scoped(engine, s, name, raw); if (out && s.kind !== 'staff') out = aliasStaff(engine, out); } catch (e) { out = null; } cache.set(ckey, out); if (cache.size > 4000) cache.clear(); }
    if (out !== null) set[name] = out;
  }
  if (since > 0) for (const [k, ver] of engine.dead) if (ver > since && k.startsWith(PFX)) del.push(k.slice(PFX.length));
  return { ver: engine.gv, set, del };
}
module.exports = { snapshot, scoped };
