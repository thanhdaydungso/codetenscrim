'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const http=require('node:http');const {once}=require('node:events');const {spawn}=require('node:child_process');
const {validateBoard,validateLogo,LogoBoardStore}=require('../logo-board-store');
const ROOT=path.resolve(__dirname,'..');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const original={teams:[{name:'Đội đã gán',person:'Andrew',code:'902000006'},{name:'Đội còn trống'},{name:'Đội đóng link'}],logos:[{name:'Ảnh gốc',image,background:image,cutout:image,scale:.85,bgColor:'#112233',keyColor:'#445566'}],assignments:[0,-1,-1],borderColor:{style:1,seed:.37,angle:-.65,shine:.45,colors:['#ffffff','#112233']},customId:'HV',defaultLogo:{name:'Mặc định',image}};
let child,base,visitorCookie="";
async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
async function start(dataDir){
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,DATA_BACKEND:'json',DATA_DIR:dataDir,PORT:String(port),ADMIN_KEY:'boards-test'},stdio:'ignore',windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/customs')).ok)return;}catch{}if(child.exitCode!==null)throw Error('Server failed');await new Promise(r=>setTimeout(r,40));}throw Error('Startup timed out');
}
async function login(){const r=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'boards-test'})});return r.headers.get('set-cookie').split(';')[0];}
async function request(url,{cookie,body,method='GET'}={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...((cookie||visitorCookie)?{Cookie:cookie||visitorCookie}:{})},body:body?JSON.stringify(body):undefined});const setCookie=response.headers.get('set-cookie');if(setCookie?.startsWith('logo_sender='))visitorCookie=setCookie.split(';')[0];return {status:response.status,body:await response.json()};}

(async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'logo-boards-'));
 try{
  assert.throws(()=>validateLogo({image:'data:image/svg+xml;base64,PHN2Zz4='}),e=>e.status===400);
  assert.throws(()=>validateLogo({image:'data:image/png;base64,AAAA'}),e=>e.status===400);
  assert.throws(()=>validateBoard({...original,assignments:[9,-1,-1]}),e=>e.status===400);
  const damaged=Buffer.from(image.slice(22),'base64');damaged[damaged.length-20]^=1;
  assert.throws(()=>validateLogo({image:'data:image/png;base64,'+damaged.toString('base64')}),e=>e.status===400);
  // A valid noisy PNG above the previous 2 MB cap must now be accepted.
  const crypto=require('node:crypto'),zlib=require('node:zlib');
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);return b;};
  const header=Buffer.alloc(13);header.writeUInt32BE(800);header.writeUInt32BE(800,4);header[8]=8;header[9]=6;
  const pixels=crypto.randomBytes((800*4+1)*800);for(let y=0;y<800;y++)pixels[y*(800*4+1)]=0;
  const largePng=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  assert(largePng.length>2_097_152);const largeImage='data:image/png;base64,'+largePng.toString('base64');
  assert.equal(validateLogo({image:largeImage}).image,largeImage);
  assert.throws(()=>validateLogo({image:'data:image/png;base64,'+'A'.repeat(14_000_000)}),e=>e.status===400);
  const validated=validateBoard(original);assert.equal(validated.borderColor.angle,-.65);assert.equal(validated.logos[0].scale,.85);
  let forwarded;const cloud=new LogoBoardStore({dataDir,storage:{rpc:async(name,args)=>{forwarded={name,args};return [];}}});await cloud.call('list');assert.equal(forwarded.name,'scrim_logo_board');assert.equal(forwarded.args.operation,'list');
  await start(dataDir);let cookie=await login();
  let result=await request('/api/admin/logo-boards');assert.equal(result.status,401);
  result=await request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'Bảng thử',data:original}});assert.equal(result.status,201);
  const board=result.body.data;assert.equal(board.token.length,64);assert.equal(board.data,undefined,'Create response should not repeat all image data');const stored=await request('/api/admin/logo-boards/'+board.id,{cookie});assert.deepEqual(stored.body.data.data,validated);
  const requestId=crypto.randomUUID();
  const repeated=await Promise.all([1,2].map(()=>request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'Retry-safe backup',data:original,requestId}})));
  assert.equal(repeated[0].body.data.id,repeated[1].body.data.id,'Retry must not duplicate backup');
  const share='/api/logo-share/'+board.token;
  result=await request(share);assert.equal(result.status,200);assert.equal(result.body.data.teams[0].assigned,true);assert.equal(result.body.data.teams[1].assigned,false);
  assert(!result.body.data.data);assert(!result.body.data.logos);assert(!result.body.data.token);
  result=await request('/api/logo-share/'+'f'.repeat(64));assert.equal(result.status,404);
  result=await request(share,{method:'POST',body:{slot:0,image}});assert.equal(result.status,409,'Assigned logo may not be replaced');
  result=await request(share,{method:'POST',body:{slot:1,image:'data:image/png;base64,AAAA'}});assert.equal(result.status,400);
  const simultaneous=await Promise.all([request(share,{method:'POST',body:{slot:1,image:largeImage}}),request(share,{method:'POST',body:{slot:1,image}})]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
  result=await request('/api/admin/logo-boards/'+board.id,{cookie});assert.equal(result.body.data.data.assignments[0],0);assert.equal(result.body.data.data.assignments[1],1);assert.equal(result.body.data.data.logos.length,2);
  result=await request('/api/admin/logo-boards',{cookie});assert.equal(result.body.data.find(item=>item.id===board.id).missing,1);
  result=await request('/api/admin/logo-boards/'+board.id,{cookie,method:'PATCH',body:{accepting:false}});assert.equal(result.status,405);
  result=await request(share);assert.equal(result.body.data.accepting,true);
  result=await request(share,{method:'POST',body:{slot:2,image}});assert.equal(result.status,409,'One sender cannot submit for another team');
  result=await request(share);assert.equal(result.body.data.submitted,true);
  visitorCookie='';await request(share);
  result=await request(share,{method:'POST',body:{slot:2,image}});assert.equal(result.status,201);
  result=await request(share);assert.equal(result.body.data.accepting,false,'Last logo must auto-lock link');
  result=await request(share,{method:'POST',body:{slot:2,image}});assert.equal(result.status,409);
  await stop();await start(dataDir);cookie=await login();
  result=await request('/api/admin/logo-boards/'+board.id,{cookie});assert.equal(result.body.data.data.logos.length,3);assert.equal(result.body.data.accepting,false);
  result=await request('/api/admin/logo-boards/'+board.id,{cookie,method:'PATCH',body:{accepting:true}});assert.equal(result.status,405,'Cannot reopen complete board');
  result=await request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'',data:original}});assert.equal(result.status,400,'Backup name is required');
  result=await request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'ĐÃ ĐỦ LOGO',data:{...original,assignments:[0,0,0]}}});assert.equal(result.status,201);assert.equal(result.body.data.name,'ĐÃ ĐỦ LOGO');assert.equal(result.body.data.accepting,false,'Complete boards must start locked');
  const largerBackup=await request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'Large backup',data:{...original,logos:[{name:'Large PNG',image:largeImage}]}}});
  assert.equal(largerBackup.status,201,'Large backup request should be accepted');
  // Expiration is based on creation time and is never extended by writes.
  let now=Date.parse('2026-10-17T00:00:00Z');
  const expiryDir=path.join(dataDir,'expiry');const expiring=new LogoBoardStore({dataDir:expiryDir,now:()=>now});
  const temporary=await expiring.call('create',{payload:{name:'2-hour backup',data:validated}});
  const expires=temporary.expires_at;assert.equal(Date.parse(expires),now+7_200_000);
  now+=3_600_000;
  await expiring.call('submit',{token:temporary.token,payload:{slot:1,logo:validateLogo({image}),visitor:'a'.repeat(64)}});
  await assert.rejects(expiring.call('close',{id:temporary.id,payload:{accepting:false}}),e=>e.status===405);
  assert.equal((await expiring.call('read',{id:temporary.id})).expires_at,expires);
  await assert.rejects(expiring.call('submit',{token:temporary.token,payload:{slot:2,logo:validateLogo({image}),visitor:'a'.repeat(64)}}),e=>e.status===409);
  const raceBoard=await expiring.call('create',{payload:{name:'Sender race',data:validated}});
  const race=await Promise.allSettled([1,2].map(slot=>expiring.call('submit',{token:raceBoard.token,payload:{slot,logo:validateLogo({image}),visitor:'b'.repeat(64)}})));
  assert.equal(race.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(race.filter(item=>item.status==='rejected'&&item.reason.status===409).length,1);
  const raceRecords=JSON.parse(fs.readFileSync(path.join(expiryDir,'logo-boards.json'),'utf8'));fs.writeFileSync(path.join(expiryDir,'logo-boards.json'),JSON.stringify(raceRecords.filter(item=>item.id!==raceBoard.id)));
  now=Date.parse(expires)-1;assert.equal((await expiring.call('list')).length,1);
  now++;await assert.rejects(expiring.call('public',{token:temporary.token}),e=>e.status===404);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(expiryDir,'logo-boards.json'),'utf8')),[]);
  const cleanupBoard=await expiring.call('create',{payload:{name:'cleanup',data:validated}});
  now=Date.parse(cleanupBoard.expires_at);assert.equal((await expiring.call('cleanup')).deleted,1);
  assert.equal((await expiring.call('list')).length,0);
  assert.equal((await fetch(base+'/logo-submit.html')).status,200);
  assert.equal((await fetch(base+'/logo/backup.js',{redirect:'manual'})).status,302);
  assert.equal((await fetch(base+'/logo/backup.js',{headers:{Cookie:cookie}})).status,200);
  console.log('PASS logo-boards: snapshots/settings, public submissions, occupied slots, races, automatic open/lock, restart, authorization, >2 MB images and 2-hour expiry.');
 }finally{await stop();fs.rmSync(dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
