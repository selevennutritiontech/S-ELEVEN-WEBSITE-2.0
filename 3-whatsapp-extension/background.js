/* Finds the WhatsApp Web tab that is already open (and signed in) and sends the chat there. Opens a new tab only if there is none. */
var api = typeof browser !== 'undefined' ? browser : chrome;
function call(fn, ctx, args) { return new Promise(function (resolve) { var done = false; function fin(v) { if (!done) { done = true; resolve(v); } } try { var p = fn.apply(ctx, args.concat([fin])); if (p && typeof p.then === 'function') p.then(fin, function () { fin(null); }); } catch (e) { fin(null); } }); }
api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.cmd !== 'open' || !/^https:\/\/web\.whatsapp\.com\/send\?/.test(String(msg.url || ''))) return;
  call(api.tabs.query, api.tabs, [{ url: 'https://web.whatsapp.com/*' }]).then(function (tabs) {
    tabs = tabs || [];
    if (tabs.length) {
      var t = tabs.filter(function (x) { return x.active; })[0] || tabs[0];
      return call(api.tabs.update, api.tabs, [t.id, { url: msg.url, active: true }]).then(function () { return call(api.windows.update, api.windows, [t.windowId, { focused: true }]); }).then(function () { sendResponse({ reused: true }); });
    }
    return call(api.tabs.create, api.tabs, [{ url: msg.url }]).then(function () { sendResponse({ reused: false }); });
  });
  return true;
});
