'use strict';
/* Who may call which operation, and which identity the operation runs as.
   The browser can ask for an operation but can never choose WHO it runs as: "by", "role", "user" and the dealer code are overwritten here
   from the signed-in session. Deny by default: an operation the screens do not use is refused. */
const fs = require('node:fs');
const path = require('node:path');

const BLOCKED = new Set(['eraseAll', 'loadDemo', 'resetDemo', 'dealerLoginInfo', 'verifyDealer', 'verifyStaff', 'dealerLoginStatus', 'portalLogin', 'portalLogout', 'portalSeen', 'portalClosing', 'portalResume']);   // sign-in and attendance beats are the server's own job
const CLIENT_NOOP = new Set(['stageEvents', 'reconcileAttendance', 'releaseSlips', 'expirePreorders']);                                           // the server runs these itself on a timer
const DEALER_MUT = new Set(['addOrder', 'createPreorder', 'addPreorder', 'editPreorder', 'cancelPreorder', 'editOrder', 'cancelRevision', 'confirmRevision', 'requestReturn', 'toggleLike', 'rzpCreate', 'submitPayShot']);
const DEALER_PAY = new Set(['markPaid', 'rzpPaid']);       // a dealer may never confirm their own payment, except in the demo gateway
const IDENT_BY = new Set(['by', 'user', 'userId', 'actor']);
const DEALER_CODE = new Set(['code', 'dealerCode', 'dealer']);
/* operations whose parameters are unnamed in the source (wrapped later): which argument is "who" */
const ARG_BY = { receiveStock: 2, adjustStock: 2, markDamaged: 2, stockOut: 2, stockReturn: 2, finishPacking: 2 };
const SELF_FIRST = new Set(['clockIn', 'clockOut', 'requestCorrection', 'requestLeave', 'addPetrol', 'addReimb']);   // first argument is the employee: always yourself

const RULES = {};
const R = (roles, names) => names.forEach(n => { RULES[n] = roles; });
R(['host'], ['deleteDealer', 'saveIncPolicy', 'saveSlabs', 'saveFreightSlabs', 'saveExcl', 'setLeavePolicy', 'saveDealer']);
R(['host', 'hr'], ['saveEmployee', 'setSalary', 'savePolicy', 'addHoliday', 'delHoliday', 'hrSign', 'decideLeave', 'decideCorrection', 'decideAllow', 'markEmployeeLeft', 'suspendEmployee', 'transferEmployee', 'reinstateEmployee', 'addExEmployee', 'updateExEmployee', 'approveInc']);
R(['host', 'it'], ['saveBrand', 'removeBrand', 'setBrandActive', 'saveBrandInfo']);   // v32: only the Host and IT add / remove a brand
R(['admin', 'finance'], ['rzpPaid']);
R(['admin', 'finance', 'fieldsales'], ['addProof', 'addPayLink', 'removePayLink', 'rzpCreate']);   // v32: the Sales department no longer collects payments; Field Sales consultants still can
R(['host', 'hr', 'finance'], ['markPaid']);   // never a Field Sales Consultant: a paid order earns commission
R(['admin', 'warehouse'], ['startPacking', 'startPackingInner', 'verifyItem', 'reportDisc', 'resolveDisc', 'finishPacking', 'setPacking', 'startSamplePacking', 'verifySampleItem', 'finishSamplePacking']);
R(['admin', 'finance', 'logistics'], ['attachInvoiceFile', 'attachEwayFile', 'attachSampleInvoice', 'updateShipment', 'saveCourier', 'deleteCourier']);
R(['host', 'finance', 'logistics'], ['receiveStock', 'adjustStock', 'markDamaged', 'stockOut', 'stockReturn', 'stockIn', 'stockOutB', 'damageB', 'returnB', 'setBatchQ', 'addPurchase', 'receiveSampleStock']);   // stock in, out, returned, damaged, counts: Finance and Logistics only (the Host can too); never the Warehouse
R(['host', 'finance', 'logistics', 'warehouse'], ['countRequest']);   // the Warehouse may only ASK for a stock count
R(['host', 'sales'], ['confirmOrder']);   // a field consultant's order is confirmed by the Sales executive they are allocated to
R(['host', 'sales', 'fieldsales'], ['addPreorderBy']);
  R(['host', 'sales', 'fieldsales'], ['saveDealerAs']);   // field sales calls are refused by the data layer with a clear message
  R(['host'], ['approveRTO']);   // only the Host approves/rejects RTO
  R(['host', 'sales', 'fieldsales', 'logistics'], ['requestRTO']);   // anyone involved in the order can request an RTO
  R(['host', 'sales', 'fieldsales'], ['addVisit']);   // field consultants log visits; Sales and Host can too          // Sales and Field Sales Consultants build dealers and orders
R(['host', 'sales'], ['createSample', 'saveOffer', 'deleteOffer', 'saveFreebie', 'deleteFreebie', 'setTarget']);   // offers, freebies and targets are not for field consultants
R(['host', 'sales', 'fieldsales'], ['saveCrm', 'crmNote', 'crmToDealer']);   // a consultant adds leads and notes; the data layer refuses any change to a saved lead
R(['host', 'sales'], ['deleteCrm', 'setFieldBrand']);
R(['host'], ['setFieldCommission']);   // only the Host sets the commission (percentage, fixed amount or by order size)
R(['fieldsales'], ['editVisit']);   // a consultant edits their own visits (the data layer checks they are the owner)           // the CRM and the brand switches belong to Sales (the data layer limits brand switches to the allocated person)
R(['admin', 'branding', 'it'], ['savePost', 'deletePost', 'addTask', 'setTask']);
R(['warehouse'], ['warehouseDispatch']);                        // only the Warehouse presses "Order dispatched"
R(['logistics'], ['markOutForDelivery', 'markDelivered']);         // only Logistics marks out for delivery / delivered
R(['logistics', 'finance'], ['setTracking']);                     // tracking is added by Logistics or Finance, after the Warehouse dispatches
R(['warehouse'], ['warehouseDispatch']);                 // only the Warehouse marks an order dispatched
R(['logistics', 'finance'], ['setTracking']);          // tracking: Logistics or Finance, after dispatch
R(['logistics'], ['markOutForDelivery', 'markDelivered']);   // out for delivery / delivered: Logistics only

function roleOk(s, roles) { return roles.some(r => (r === 'host' || r === 'hr' || r === 'sales' || r === 'fieldsales') ? s.dept === r : s.role === r); }   // host, hr, sales and fieldsales are DEPARTMENTS; the others are roles

function names(dir, files) { const out = new Set(); for (const f of files) { try { const t = fs.readFileSync(path.join(dir, 'js', f), 'utf8'); for (const m of t.matchAll(/DB\.([A-Za-z0-9_]+)\s*\(/g)) out.add(m[1]); } catch (e) {} } return out; }
class Acl {
  constructor(cfg, engine) {
    this.cfg = cfg; this.engine = engine; const known = new Set(Object.keys(engine.sigs));
    this.staffFns = new Set([...names(cfg.portalDir, ['admin.js', 'staffai.js', 'agent.js', 'auth.js', 'sheets.js', 'share.js', 'docs.js'])].filter(n => known.has(n) && !BLOCKED.has(n) && !CLIENT_NOOP.has(n)));
    for (const n of Object.keys(RULES)) if (known.has(n)) this.staffFns.add(n);
  }
  /* returns { error } or { fn, args, noop?, place? } */
  authorize(s, fn, args) {
    fn = String(fn || ''); args = Array.isArray(args) ? args.slice(0, 12) : [];
    if (!Object.prototype.hasOwnProperty.call(this.engine.sigs, fn)) return { error: 'Unknown operation.' };
    if (BLOCKED.has(fn)) return { error: 'This operation is not available.', denied: true };
    if (CLIENT_NOOP.has(fn)) return { noop: true };
    const sig = this.engine.sigs[fn] || [];
    if (s.kind === 'dealer') {
      const ok = DEALER_MUT.has(fn) || (DEALER_PAY.has(fn) && this.cfg.demoPayments);
      if (!ok) return { error: 'You are not allowed to do that.', denied: true };
      sig.forEach((p, i) => { if (DEALER_CODE.has(p)) args[i] = s.code; else if (IDENT_BY.has(p)) args[i] = s.code; else if (p === 'role') args[i] = 'dealer'; });
      if (fn === 'addOrder') return { fn: '__placeOrder', args: [s.code, JSON.stringify(args[1] || {}), JSON.stringify({ code: s.code, name: s.name, role: 'dealer' }), false] };
      return { fn, args };
    }
    if (!this.staffFns.has(fn)) return { error: 'You are not allowed to do that.', denied: true };
    if (RULES[fn] && !roleOk(s, RULES[fn])) return { error: 'Your department is not allowed to do that.', denied: true };
    if (s.dept !== 'host' && EMP_TARGET.has(fn)) { const tid = fn === 'saveEmployee' ? String((args[0] || {}).id || '') : String(args[0] || ''), emps = this.engine.get('employees') || [], t = emps.find(e => e.id === tid.toUpperCase()); if ((t && t.dept === 'fieldsales') || (fn === 'saveEmployee' && args[0] && String(args[0].dept || '') === 'fieldsales')) return { error: 'Only the Host can create or change a Field Sales Consultant.', denied: true }; }
    sig.forEach((p, i) => { if (IDENT_BY.has(p)) args[i] = s.code; else if (p === 'role') args[i] = s.role; });
    if (ARG_BY[fn] !== undefined) args[ARG_BY[fn]] = s.code;
    if (SELF_FIRST.has(fn)) args[0] = s.code;
    if (fn === 'addOrder') return { fn: '__placeOrder', args: [String(args[0] || ''), JSON.stringify(args[1] || {}), JSON.stringify({ code: s.code, name: s.name, role: s.role }), s.role === 'employee' || s.role === 'admin'] };
    return { fn, args };
  }
}
/* A Field Sales Consultant may only CREATE. Whatever they call, if it would change stored data and is not on this list, the server refuses it and discards the change. */
const EMP_TARGET = new Set(['saveEmployee', 'setSalary', 'markEmployeeLeft', 'suspendEmployee', 'transferEmployee', 'reinstateEmployee', 'decideAllow', 'decideLeave']);   // a consultant's record is the Host's alone
const FIELD_WRITE = new Set(['editVisit', 'saveDealerAs', 'crmToDealer', 'saveCrm', 'crmNote', 'addOrder', '__placeOrder', 'addProof', 'addPayLink', 'removePayLink', 'addPreorderBy', 'addVisit', 'markSeen', 'stageEvents']);
module.exports = { Acl, RULES, BLOCKED, DEALER_MUT, FIELD_WRITE };
