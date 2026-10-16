'use strict';
// Real Chromium smoke test using its DevTools protocol; no npm dependencies.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const browserPath=process.env.UI_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
(async()=>{
  assert(browserPath,'Set UI_BROWSER to a Chromium executable');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'code-web-ui-'));
  const data=path.join(temp,'data');fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'customs.json'),JSON.stringify([{id:'MP',name:'MP',teamRegion:'SCRIM MP',color:'#30F708',locked:false},{id:'HV',name:'HV',teamRegion:'SCRIM HV',color:'#FFFFFF',locked:false}]));
  const port=await freePort(),debug=await freePort(),base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:data,ADMIN_KEY:'ui-test-secret'},stdio:'ignore',windowsHide:true});
  let browser,ws;
  try {
    async function until(fn,label){for(let i=0;i<150;i++){try{const value=await fn();if(value)return value;}catch{}await delay(100);}throw Error('Timed out: '+label);}
    await until(async()=> (await fetch(base+'/api/customs')).ok,'server');
    await fetch(base+'/api/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customId:'MP',teamName:'UI TEST',players:[{playerId:'123456789',playerName:'SMOKE.PLAYER'}]})});
    browser=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port='+debug,'--user-data-dir='+path.join(temp,'browser'),'about:blank'],{stdio:'ignore',windowsHide:true});
    const pages=await until(async()=> (await fetch('http://127.0.0.1:'+debug+'/json')).json(),'browser');
    ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0;const pending=new Map(),errors=[];
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+(m.params.exceptionDetails.exception?.description||''));};
    function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
    async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||'Evaluation failed');return result.result.value;}
    await send('Runtime.enable');await send('Page.enable');
    async function size(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});}
    async function go(route,ready){await send('Page.navigate',{url:base+route});await until(()=>evaluate('location.pathname === '+JSON.stringify(route)+' && !!('+ready+')'),'page '+route);await delay(250);}
    async function screenshot(name){await delay(800);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(temp,name+'.png'),Buffer.from(shot.data,'base64'));}
    async function fits(){assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),'Horizontal overflow at '+await evaluate('location.pathname'));}
    await size(1440,1000);await go('/','document.querySelectorAll(".custom-card").length===2');await fits();await screenshot('home-desktop');
    assert(await evaluate('getComputedStyle(document.querySelector(".hero h1")).fontStyle')==='normal');
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()'),'#dbfd85');
    assert(await evaluate('!document.querySelector(".hero-guide") && !!document.querySelector("#heroSculpture")'));
    await evaluate('document.querySelector("#customDirectory").scrollIntoView({behavior:"instant"})');await screenshot('directory-desktop');
    await evaluate('scrollTo({top:0,behavior:"instant"})');
    await evaluate('document.querySelector("#customSearch").value="mp";document.querySelector("#customSearch").dispatchEvent(new Event("input"));');assert.equal(await evaluate('document.querySelectorAll(".custom-card").length'),1);
    await evaluate('document.querySelector("[data-status-filter=locked]").click()');assert(await evaluate('document.querySelector(".empty-state").textContent.includes("Không tìm")'));
    await size(390,844);await go('/','document.querySelectorAll(".custom-card").length===2');await fits();await screenshot('home-mobile');
    await go('/custom/MP','document.querySelectorAll(".member-row").length===1');await fits();await screenshot('custom-mobile');
    await evaluate('document.querySelector("#addMember").click()');assert.equal(await evaluate('document.querySelectorAll(".member-row").length'),2);
    await size(1440,1000);await go('/admin','!!document.querySelector("#loginForm")');
    await evaluate('document.querySelector("#adminPassword").value="ui-test-secret";document.querySelector("#loginForm").requestSubmit()');await until(()=>evaluate('!document.querySelector("#dashboard").hidden && document.querySelectorAll(".team-editor").length===1'),'admin login');
    await fits();await screenshot('admin-desktop');
    await evaluate('document.querySelector("#adminTeamSearch").value="missing";document.querySelector("#adminTeamSearch").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelectorAll(".team-editor:not([hidden])").length'),0);
    await evaluate('document.querySelector("#adminTeamSearch").value="123456789";document.querySelector("#adminTeamSearch").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelectorAll(".team-editor:not([hidden])").length'),1);
    assert.equal(await evaluate('document.querySelector("[data-custom-id=MP] [data-field=color]").value'),'#ffffff');
    await size(390,844);await fits();await screenshot('admin-mobile');
    await size(1440,1000);await go('/logo/','!!document.querySelector("#resetDefaultLogo")');await fits();await screenshot('logo-desktop');
    await evaluate('document.querySelector("#teamInput").value="1 UI TEAM";document.querySelector("#replace").click();document.querySelector("#borderColor").value="#ff0000";document.querySelector("#borderColor").dispatchEvent(new Event("input"));');assert.equal(await evaluate('document.querySelectorAll("#roster tr").length'),1);
    await size(390,844);await fits();await screenshot('logo-mobile');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await evaluate('getComputedStyle(document.querySelector("main")).animationName'),'none');
    await go('/','document.querySelectorAll(".custom-card").length===2');
    const still=await evaluate('document.querySelector("#heroSculpture").toDataURL()');
    await delay(180);
    assert.equal(await evaluate('document.querySelector("#heroSculpture").toDataURL()'),still,'Sculpture moved with reduced motion enabled');
    assert.deepEqual(errors,[],'Browser runtime errors');
    console.log('PASS UI: desktop/mobile home, search/filter, registration, admin login/team search, MP white, logo border, reduced motion.');
    console.log('Screenshots: '+temp);
  }finally{if(ws)ws.close();if(browser)browser.kill();server.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
