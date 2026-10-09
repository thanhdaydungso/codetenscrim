'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DATA = path.join(ROOT, `.test-export-${process.pid}`);
let serverProcess;
let port;
let baseUrl;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const selected = probe.address().port;
      probe.close(() => resolve(selected));
    });
  });
}

async function startServer() {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ADMIN_KEY: 'test-export-secret', DATA_DIR: TEST_DATA },
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/customs`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server kiểm thử không khởi động.');
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await new Promise(resolve => serverProcess.once('exit', resolve));
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const body = await response.json();
  return { response, body };
}

async function login() {
  const result = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-export-secret' })
  });
  assert(result.response.ok, 'Không đăng nhập được tài khoản BTC.');
  return result.response.headers.get('set-cookie').split(';')[0];
}

function admin(url, cookie, options = {}) {
  return request(url, {
    ...options,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

function submit(customId, teamName, players) {
  return request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customId, teamName, players })
  });
}

async function exportCustom(customId, cookie) {
  const response = await fetch(`${baseUrl}/api/admin/export/${customId}?_ts=${Date.now()}`, {
    headers: { Cookie: cookie },
    cache: 'no-store'
  });
  return { response, body: await response.json() };
}

async function run() {
  const { nextVietnamReset } = require('../reset-schedule');
  for (const [input, expected] of [
    ['2026-10-09T20:59:59.000Z', '2026-10-09T21:00:00.000Z'],
    ['2026-10-09T21:00:00.000Z', '2026-10-10T21:00:00.000Z'],
    ['2026-10-09T22:00:00.000Z', '2026-10-10T21:00:00.000Z'],
    ['2026-12-31T22:00:00.000Z', '2027-01-01T21:00:00.000Z']
  ]) assert(nextVietnamReset(new Date(input)).toISOString() === expected, 'Incorrect Vietnam reset time: ' + input);

  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await startServer();
  let cookie = await login();
  const logoPaths = ['/logo', '/admin/logo', '/logo/', '/logo/index.html', '/logo/style.css', '/logo/script.js', '/logo/avatars_b64.js', '/logo/logo-bundle.js', '/logo/avatars/Andrew.png', '/logo/avatars/Kelly.png'];
  for (const route of logoPaths) {
    for (const headers of [{}, { Cookie: 'btc_session=invalid' }]) {
      const response = await fetch(baseUrl + route, { headers, redirect: 'manual' });
      assert(response.status === 302 && response.headers.get('location') === '/admin', 'Logo ph?i ch?n kh?ch: ' + route);
    }
  }
  for (const route of logoPaths.slice(2)) {
    const response = await fetch(baseUrl + route, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert(response.status === 200, 'Admin kh?ng m? ???c logo: ' + route);
    assert(response.headers.get('cache-control') === 'no-store', 'Logo kh?ng ???c cache: ' + route);
    if (route.endsWith('.png')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10', 'Invalid avatar PNG: ' + route);
      continue;
    }
    const content = await response.text();
    assert(content.length > 0, 'File logo r?ng: ' + route);
    if (route === '/logo/') assert(content.includes('class="code-menu"') && content.includes('href="/admin"'), 'Missing admin menu link.');
  }
  const privateFile = await fetch(baseUrl + '/private/logo/script.js', { redirect: 'manual' });
  assert(privateFile.status === 404, 'File ri?ng t? b? l? qua static.');
  const logoCookie = await login();
  await admin('/api/admin/logout', logoCookie, { method: 'POST' });
  const loggedOut = await fetch(baseUrl + '/logo/script.js', { headers: { Cookie: logoCookie }, redirect: 'manual' });
  assert(loggedOut.status === 302, 'Phi?n ?? ??ng xu?t v?n truy c?p ???c logo.');
  const ynExport = await exportCustom('YN', cookie);
  assert(ynExport.response.ok && ynExport.response.headers.get('content-disposition').includes('PlayerNameOverwrite.json'), 'YN filename must be PlayerNameOverwrite.json');
  const defaultCustoms = await request('/api/customs');
  assert(defaultCustoms.body.data.some(custom => custom.id === 'YN'), 'Custom YN chưa được tạo mặc định.');

  const created = await submit('HV', 'TEST', [
    { playerId: '992836236', playerName: 'TEST.PLAYER' },
    { playerId: '111222333', playerName: 'TEST.SECOND' }
  ]);
  assert(created.response.status === 201, 'Không tạo được team TEST.');
  const { submissionId, editToken } = created.body.data;
  assert(created.body.data.team.status === 'approved', 'Team gửi lên chưa được tự động lưu/duyệt.');

  let output = await exportCustom('HV', cookie);
  assert(output.response.ok, 'Export failed.');
  assert(output.body.PlayerNameList.every(player => player.Color === '#FFFFFF'), 'Default player color must be white.');
  assert(output.body.TeamRegionList.every(region => region.Color === '#FFFFFF'), 'Default region color must be white.');
  assert(output.response.headers.get('content-disposition').includes('PlayerNameOverwrite.json'), 'Wrong download filename.');

  assert(output.body.PlayerNameList.filter(player => player.PlayerID === 992836236).length === 1, 'PlayerID bị xuất trùng.');
  assert(output.response.headers.get('cache-control').includes('no-store'), 'File export chưa tắt cache.');

  const updated = await request(`/api/submissions/${editToken}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teamName: 'TEST ESPORT',
      players: [{ playerId: '111222333', playerName: 'TEST.PLAYER_NEW' }]
    })
  });
  assert(updated.response.ok && updated.body.data.team.id === submissionId, 'Edit token tạo sai team hoặc cập nhật thất bại.');
  assert(updated.body.data.team.status === 'approved', 'Team cập nhật bị chuyển về chờ duyệt.');
  output = await exportCustom('HV', cookie);
  assert(output.body.PlayerNameList.length === 1, 'Player đã xóa vẫn còn trong export.');
  assert(output.body.PlayerNameList[0].PlayerNameOverwrite === 'TEST.PLAYER_NEW', 'Export vẫn dùng tên ingame cũ.');
  assert(output.body.PlayerNameList[0].PlayerNation === 'TEST ESPORT', 'PlayerNation chưa theo tên team mới.');

  await admin(`/api/admin/teams/${submissionId}`, cookie, {
    method: 'PUT',
    body: JSON.stringify({
      teamName: 'BTC EDITED', customId: 'HV', playerNation: 'BTC NATION', color: '#ABCDEF',
      players: [{ playerId: '111222334', playerName: 'BTC.PLAYER.NEW' }]
    })
  });
  await admin('/api/admin/customs/HV', cookie, {
    method: 'PUT', body: JSON.stringify({ teamRegion: 'CUSTOM MỚI', color: '#123456' })
  });
  output = await exportCustom('HV', cookie);
  assert(output.body.PlayerNameList[0].PlayerID === 111222334, 'Export chưa dùng ID BTC vừa sửa.');
  assert(output.body.PlayerNameList[0].PlayerNation === 'BTC NATION', 'Export chưa ưu tiên PlayerNation riêng.');
  assert(output.body.PlayerNameList[0].Color === '#ABCDEF', 'Export chưa ưu tiên màu team.');
  assert(output.body.TeamRegionList.length === 15, 'TeamRegionList không đủ 15 slot.');
  assert(output.body.TeamRegionList.every(item => item.TeamRegion === 'CUSTOM MỚI'), 'TeamRegion còn giá trị cũ.');

  const preview = await admin('/api/admin/export-preview/HV', cookie);
  assert(preview.body.data.synchronized && preview.body.data.ready, 'Preview chưa đồng bộ hoặc báo sai trạng thái.');

  const duplicate = await submit('MP', 'DUP TEAM', [{ playerId: '111222334', playerName: 'DUP.PLAYER' }]);
  assert(duplicate.body.data.team.status === 'approved', 'Team ở custom khác chưa được tự động lưu.');
  const exportAll = await admin('/api/admin/export-all', cookie);
  assert(exportAll.response.status === 409, 'Export-all không chặn PlayerID trùng.');
  assert(exportAll.body.conflicts?.[0]?.teams.length === 2, 'Response xung đột không chỉ rõ hai team.');

  await stopServer();
  const storedTeamsFile = path.join(TEST_DATA, 'submissions.json');
  const legacyTeams = JSON.parse(fs.readFileSync(storedTeamsFile, 'utf8'));
  legacyTeams.find(team => team.id === submissionId).status = 'pending';
  fs.writeFileSync(storedTeamsFile, JSON.stringify(legacyTeams, null, 2), 'utf8');
  const customsFile = path.join(TEST_DATA, 'customs.json');
  const legacyCustoms = JSON.parse(fs.readFileSync(customsFile, 'utf8'));
  const yn = legacyCustoms.find(custom => custom.id === 'YN');
  yn.color = '#E08B2D';
  delete yn.whiteDefaultMigrated;
  fs.writeFileSync(customsFile, JSON.stringify(legacyCustoms), 'utf8');
  await startServer();
  cookie = await login();
  const restartedCustoms = await request('/api/customs');
  assert(restartedCustoms.body.data.find(custom => custom.id === 'YN').color === '#FFFFFF', 'Old YN default was not migrated to white');
  assert(restartedCustoms.body.data.find(custom => custom.id === 'HV').color === '#123456', 'Admin-selected color was overwritten');
  output = await exportCustom('HV', cookie);
  assert(output.body.PlayerNameList[0].PlayerNameOverwrite === 'BTC.PLAYER.NEW', 'Restart server trả dữ liệu cũ.');
  assert(output.body.TeamRegionList.every(item => item.TeamRegion === 'CUSTOM MỚI'), 'Restart server làm mất TeamRegion mới.');
  const migratedTeams = JSON.parse(fs.readFileSync(storedTeamsFile, 'utf8'));
  assert(migratedTeams.find(team => team.id === submissionId).status === 'approved', 'Dữ liệu pending cũ chưa được tự động chuyển sang đã lưu.');
}

(async () => {
  try {
    await run();
    console.log('PASS export-flow: dữ liệu mới, xóa/cập nhật, BTC edit, preview, conflict và restart.');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await stopServer();
    if (path.dirname(TEST_DATA) !== ROOT || !path.basename(TEST_DATA).startsWith('.test-export-')) throw new Error('Unsafe test cleanup path');
    fs.rmSync(TEST_DATA, { recursive: true, force: true });
  }
})();
