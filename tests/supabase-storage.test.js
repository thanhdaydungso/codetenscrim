'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { SupabaseStorage } = require('../supabase-storage');
const ROOT = path.resolve(__dirname, '..');
let cloudState = null, offline = false, processHandle, appUrl;
const backups = [];
let reads = 0;
const secret = 'test-server-secret';
const clone = value => structuredClone(value);
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const args = JSON.parse(body || '{}');
  const name = req.url.split('/').pop();
  const reply = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
  if (req.headers.apikey !== secret) return reply(401, {message: 'Unauthorized'});
  if (offline) return reply(503, {message: 'offline'});
  if (name === 'scrim_read') { reads++; return reply(200, cloudState); }
  if (name === 'scrim_initialize') {
    cloudState ||= { customs: args.initial_customs, teams: args.initial_teams, revision: 0 };
    return reply(200, cloudState);
  }
  if (args.expected_revision !== cloudState.revision) return reply(400, {message: 'SCRIM_CONFLICT'});
  if (name === 'scrim_write') {
    if (args.collection === 'customs' && cloudState.customs.some(old => !args.items.some(item => item.id === old.id))) return reply(400, {message: 'SCRIM_CUSTOM_DELETE_FORBIDDEN'});
    cloudState = {...cloudState, [args.collection]: args.items, revision: cloudState.revision + 1};
    return reply(200, cloudState);
  }
  if (name === 'scrim_backup') { backups.push({label: args.backup_label, state: clone(cloudState)}); return reply(200, null); }
  reply(404, {});
});
async function stop() {
  if (processHandle && processHandle.exitCode === null) {
    const exited = once(processHandle, 'exit'); processHandle.kill(); await exited;
  }
}
async function freePort() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function start(dataDir, cloudUrl) {
  const port = await freePort(); appUrl = 'http://127.0.0.1:' + port;
  processHandle = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: {
    ...process.env, DATA_BACKEND: 'supabase', SUPABASE_URL: cloudUrl, SUPABASE_SECRET_KEY: secret,
    DATA_DIR: dataDir, PORT: String(port), ADMIN_KEY: 'test-admin'
  }});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processHandle.exitCode !== null) throw new Error('App startup failed');
    try { if ((await fetch(appUrl + '/api/customs')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('App did not start');
}
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrim-supabase-'));
  try {
    mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
    const cloudUrl = 'http://127.0.0.1:' + mock.address().port;
    const db = new SupabaseStorage({url: cloudUrl, secret});
    await db.initialize([], []);
    const calls = reads;
    await db.run(async () => { await db.read('teams'); await db.read('customs'); });
    assert.equal(reads, calls + 1, 'Request must share one snapshot');
    // Two independent instances read the same version; only the first write may succeed.
    let release; const gate = new Promise(resolve => { release = resolve; });
    let ready; const loaded = new Promise(resolve => { ready = resolve; });
    const stale = db.run(async () => { await db.snapshot(); ready(); await gate;
      await assert.rejects(db.write('teams', [{id: 'lost'}]), error => error.status === 409);
    });
    await loaded;
    const other = new SupabaseStorage({url: cloudUrl, secret});
    await other.run(() => other.write('teams', [{id: 'winner'}]));
    release(); await stale;
    assert.equal(cloudState.teams[0].id, 'winner');
    offline = true;
    await assert.rejects(db.run(() => db.read('teams')), error => error.status === 503);
    offline = false;
    const sqlTimeout = new SupabaseStorage({url:cloudUrl,secret,fetchImpl:async()=>new Response(JSON.stringify({code:'57014',message:'statement timeout'}),{status:500})});
    await assert.rejects(sqlTimeout.read('teams'),error=>error.status===504 && error.message.includes('57014'));
    const sqlFailure = new SupabaseStorage({url:cloudUrl,secret,fetchImpl:async()=>new Response(JSON.stringify({code:'23505',message:secret}),{status:500})});
    await assert.rejects(sqlFailure.read('teams'),error=>error.message.includes('23505') && !error.message.includes(secret));
    const missing = new SupabaseStorage({url: cloudUrl, secret, fetchImpl: async () => new Response(JSON.stringify({code:'PGRST202'}), {status:404})});
    await assert.rejects(missing.read('teams'), /schema.sql/);
    const broken = new SupabaseStorage({url: cloudUrl, secret, fetchImpl: async () => { throw new Error(secret); }});
    await assert.rejects(broken.read('teams'), error => error.status === 503 && !error.message.includes(secret));
    // Application integration against the RPC contract. No production data is touched.
    cloudState = null;
    await start(dataDir, cloudUrl);
    const login = await fetch(appUrl + '/api/admin/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-admin'})});
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const admin = (url, method='GET', body) => fetch(appUrl + url, {method, headers:{Cookie:cookie,'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined});
    let result = await admin('/api/admin/customs','POST',{name:'CLOUD'});
    assert.equal(result.status, 201);
    const custom = (await result.json()).data;
    result = await fetch(appUrl + '/api/submissions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customId:custom.id,teamName:'CLOUD TEAM',players:[{playerId:'123456789',playerName:'CLOUD.PLAYER'}]})});
    assert.equal(result.status, 201);
    const submitted = (await result.json()).data;
    const team = {...submitted.team, editToken: submitted.editToken};
    assert(team.editToken);
    result = await admin('/api/admin/export/' + custom.id);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).PlayerNameList[0].PlayerNameOverwrite, 'CLOUD.PLAYER');
    assert(!fs.existsSync(path.join(dataDir, 'submissions.json')), 'Cloud writes must not require local data files');
    await stop();
    // A stale deployment file must never overwrite existing Supabase data.
    fs.writeFileSync(path.join(dataDir, 'customs.json'), '[]');
    fs.writeFileSync(path.join(dataDir, 'submissions.json'), '[]');
    await start(dataDir, cloudUrl);
    result = await fetch(appUrl + '/api/customs');
    assert((await result.json()).data.some(item => item.id === custom.id));
    assert.equal(cloudState.teams[0].editToken, team.editToken);
    const relogin = await fetch(appUrl + '/api/admin/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-admin'})});
    const nextCookie = relogin.headers.get('set-cookie').split(';')[0];
    const before = clone(cloudState.customs);
    result = await fetch(appUrl + '/api/admin/customs/' + custom.id + '?confirm=yes', {method:'DELETE',headers:{Cookie:nextCookie}});
    assert.equal(result.status, 403);
    result = await fetch(appUrl + '/api/admin/customs/' + custom.id + '/teams', {method:'DELETE',headers:{Cookie:nextCookie}});
    assert.equal(result.status, 405);
    assert.equal(cloudState.teams.length, 1);
    assert.equal(cloudState.teams[0].id, team.id);
    assert.deepEqual(cloudState.customs, before);
    assert(!backups.some(item => item.label.startsWith('clear-custom-')), 'Disabled reset created a backup');
    offline = true;
    result = await fetch(appUrl + '/api/customs');
    assert.equal(result.status, 503, 'Cloud errors must not fall back to local JSON');
    assert.deepEqual(cloudState.customs, before);
    console.log('PASS supabase-storage: cloud persistence/export, restart, disabled reset, snapshot, concurrent writes, failures.');
  } finally {
    offline = false; await stop();
    await new Promise(resolve => mock.close(resolve));
    fs.rmSync(dataDir, {recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
