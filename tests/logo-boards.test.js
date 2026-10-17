'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const http=require('node:http');const {once}=require('node:events');const {spawn}=require('node:child_process');
const {validateBoard,validateLogo,LogoBoardStore}=require('../logo-board-store');
const ROOT=path.resolve(__dirname,'..');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const original={teams:[{name:'Đội đã gán',person:'Andrew',code:'902000006'},{name:'Đội còn trống'},{name:'Đội đóng link'}],logos:[{name:'Ảnh gốc',image,background:image,cutout:image,scale:.85,bgColor:'#112233',keyColor:'#445566'}],assignments:[0,-1,-1],borderColor:{style:1,seed:.37,angle:-.65,shine:.45,colors:['#ffffff','#112233']},customId:'HV',defaultLogo:{name:'Mặc định',image}};
let child,base;
async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
async function start(dataDir){
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,DATA_BACKEND:'json',DATA_DIR:dataDir,PORT:String(port),ADMIN_KEY:'boards-test'},stdio:'ignore',windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/customs')).ok)return;}catch{}if(child.exitCode!==null)throw Error('Server failed');await new Promise(r=>setTimeout(r,40));}throw Error('Startup timed out');
}
async function login(){const r=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'boards-test'})});return r.headers.get('set-cookie').split(';')[0];}
async function request(url,{cookie,body,method='GET'}={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
(async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'logo-boards-'));
 try{
  assert.throws(()=>validateLogo({image:'data:image/svg+xml;base64,PHN2Zz4='}),e=>e.status===400);
  assert.throws(()=>validateLogo({image:'data:image/png;base64,AAAA'}),e=>e.status===400);
  assert.throws(()=>validateBoard({...original,assignments:[9,-1,-1]}),e=>e.status===400);
  const damaged=Buffer.from(image.slice(22),'base64');damaged[damaged.length-20]^=1;
  assert.throws(()=>validateLogo({image:'data:image/png;base64,'+damaged.toString('base64')}),e=>e.status===400);
  const validated=validateBoard(original);assert.equal(validated.borderColor.angle,-.65);assert.equal(validated.logos[0].scale,.85);
  let forwarded;const cloud=new LogoBoardStore({dataDir,storage:{rpc:async(name,args)=>{forwarded={name,args};return [];}}});await cloud.call('list');assert.equal(forwarded.name,'scrim_logo_board');assert.equal(forwarded.args.operation,'list');
  await start(dataDir);let cookie=await login();
  let result=await request('/api/admin/logo-boards');assert.equal(result.status,401);
  result=await request('/api/admin/logo-boards',{cookie,method:'POST',body:{name:'Bảng thử',data:original}});assert.equal(result.status,201);
  const board=result.body.data;assert.equal(board.token.length,64);assert.deepEqual(board.data,validated);
  const share='/api/logo-share/'+board.token;
  result=await request(share);assert.equal(result.status,200);assert.equal(result.body.data.teams[0].assigned,true);assert.equal(result.body.data.teams[1].assigned,false);
  assert(!result.body.data.data);assert(!result.body.data.logos);assert(!result.body.data.token);
  result=await request('/api/logo-share/'+'f'.repeat(64));assert.equal(result.status,404);
  result=await request(share,{method:'POST',body:{slot:0,image}});assert.equal(result.status,409,'Assigned logo may not be replaced');
  result=await request(share,{method:'POST',body:{slot:1,image:'data:image/png;base64,AAAA'}});assert.equal(result.status,400);
  const simultaneous=await Promise.all([request(share,{method:'POST',body:{slot:1,image}}),request(share,{method:'POST',body:{slot:1,image}})]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
  result=await request('/api/admin/logo-boards/'+board.id,{cookie});assert.equal(result.body.data.data.assignments[0],0);assert.equal(result.body.data.data.assignments[1],1);assert.equal(result.body.data.data.logos.length,2);
  result=await request('/api/admin/logo-boards',{cookie});assert.equal(result.body.data[0].missing,1);
  await request('/api/admin/logo-boards/'+board.id,{cookie,method:'PATCH',body:{accepting:false}});
  result=await request(share,{method:'POST',body:{slot:2,image}});assert.equal(result.status,409);
  result=await request(share);assert.equal(result.body.data.accepting,false);
  await stop();await start(dataDir);cookie=await login();
  result=await request('/api/admin/logo-boards/'+board.id,{cookie});assert.equal(result.body.data.data.logos.length,2);assert.equal(result.body.data.accepting,false);
  await request('/api/admin/logo-boards/'+board.id,{cookie,method:'PATCH',body:{accepting:true}});
  result=await request(share,{method:'POST',body:{slot:2,image}});assert.equal(result.status,201);
  assert.equal((await fetch(base+'/logo-submit.html')).status,200);
  assert.equal((await fetch(base+'/logo/backup.js',{redirect:'manual'})).status,302);
  assert.equal((await fetch(base+'/logo/backup.js',{headers:{Cookie:cookie}})).status,200);
  console.log('PASS logo-boards: snapshots/settings, public submissions, occupied slots, races, close/reopen, restart, authorization.');
 }finally{await stop();fs.rmSync(dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
