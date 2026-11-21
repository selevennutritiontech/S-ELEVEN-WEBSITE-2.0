/* Runs on the S-ELEVEN portal page. It tells the page the helper is installed and passes "open this chat" requests to the background script.
   It only ever accepts WhatsApp Web chat links. */
(function () {
  var api = typeof browser !== 'undefined' ? browser : chrome;
  document.documentElement.setAttribute('data-sel-wa-ext', '1');
  function reply(o) { o.sel = 'wa-reply'; window.postMessage(o, '*'); }
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.sel !== 'wa') return;
    var d = e.data;
    if (d.cmd === 'ping') { reply({ cmd: 'pong', v: 1 }); return; }
    if (d.cmd === 'open' && typeof d.url === 'string' && /^https:\/\/web\.whatsapp\.com\/send\?/.test(d.url)) {
      var done = function (r) { reply({ cmd: 'opened', reused: !!(r && r.reused) }); };
      try { var p = api.runtime.sendMessage({ cmd: 'open', url: d.url }, done); if (p && typeof p.then === 'function') p.then(done, function () { reply({ cmd: 'failed' }); }); } catch (x) { reply({ cmd: 'failed' }); }
    }
  });
})();
