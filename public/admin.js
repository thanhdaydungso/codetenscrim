'use strict';

const $ = selector => document.querySelector(selector);
let customs = [];
let teams = [];
let selectedId = '';
let bulkTeams = [];
let appConfig = { maxPlayersPerTeam: 6 };
let exportState = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function showNotice(message, type = 'ok', target = $('#notice')) {
  target.className = `notice show ${type}`;
  target.textContent = message;
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const type = response.headers.get('content-type') || '';
  const result = type.includes('application/json') ? await response.json() : null;
  if (!response.ok || !result?.success) {
    if (response.status === 401 && path !== '/api/admin/login') showLogin();
    const detail = result?.errors?.length ? ` ${result.errors.join(' ')}` : '';
    throw new Error((result?.message || 'Yêu cầu thất bại.') + detail);
  }
  return result;
}

function showLogin() {
  $('#loginView').hidden = false;
  $('#dashboard').hidden = true;
  $('#logoutButton').hidden = true;
}

function showDashboard() {
  $('#loginView').hidden = true;
  $('#dashboard').hidden = false;
  $('#logoutButton').hidden = false;
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value || ''; }
}

function statusLabel(status) {
  return { pending: 'ĐANG CHUYỂN ĐỔI', approved: 'ĐÃ LƯU', rejected: 'KHÔNG SỬ DỤNG' }[status] || status;
}

function updateStats() {
  const allPlayers = customs.reduce((sum, custom) => sum + custom.playerCount, 0);
  const saved = selectedId ? teams.filter(team => team.status === 'approved').length : 0;
  const totalTeams = customs.reduce((sum, custom) => sum + custom.teamCount, 0);
  $('#stats').innerHTML = `<div class="stat"><b>${customs.length}</b><span>Custom</span></div><div class="stat"><b>${totalTeams}</b><span>Tổng đội</span></div><div class="stat"><b>${saved}</b><span>Đã lưu trong custom</span></div><div class="stat"><b>${allPlayers}</b><span>Người chơi</span></div>`;
}

function renderCustoms() {
  updateStats();
  if (!customs.length) {
    $('#customAdminList').innerHTML = '<div class="empty-state">Chưa có custom.</div>';
    return;
  }
  $('#customAdminList').innerHTML = customs.map(custom => `
    <article class="custom-admin-card ${custom.id === selectedId ? 'selected' : ''}" data-custom-id="${escapeHtml(custom.id)}">
      <button class="custom-select" data-action="select" type="button"><span style="background:${escapeHtml(custom.color)}"></span><b>${escapeHtml(custom.name)}</b><small>${custom.teamCount} đội · ${custom.playerCount} player · ${custom.id === selectedId ? 'XEM' : 'MỞ'}</small></button>
      <div class="custom-settings">
        <div class="field"><label>TEAM REGION</label><input data-field="teamRegion" maxlength="30" value="${escapeHtml(custom.teamRegion)}"></div>
        <div class="color-field"><input data-field="color" type="color" value="${escapeHtml(custom.color)}"><span>${custom.locked ? 'Đã khóa' : 'Đang mở'}</span></div>
        <div class="actions compact-actions">
          <button class="button secondary" data-action="save" type="button">LƯU MÀU CUSTOM</button>
          <button class="button ${custom.locked ? 'success' : 'warning'}" data-action="toggle" type="button">${custom.locked ? 'MỞ NHẬN' : 'KHÓA NHẬN'}</button>
          <button class="button danger" data-action="delete" type="button">XÓA CUSTOM</button>
        </div>
      </div>
    </article>`).join('');
}

function renderTeams() {
  updateStats();
  const selected = customs.find(custom => custom.id === selectedId);
  $('#teamHeading').textContent = selected ? `TEAM TRONG ${selected.name}` : 'TEAM TRONG CUSTOM';
  $('#exportCustom').disabled = !selected;
  $('#clearCustom').disabled = !selected;
  if (!selected) return $('#teamList').innerHTML = '<div class="empty-state">Chọn một custom để xem danh sách team.</div>';
  if (!teams.length) return $('#teamList').innerHTML = '<div class="empty-state">Custom này chưa có team.</div>';
  $('#teamList').innerHTML = [...teams].sort((a, b) => a.teamSlot - b.teamSlot).map(team => `
    <article class="team-editor" data-team-id="${escapeHtml(team.id)}">
      <div class="team-editor-head"><div><span class="team-slot">#${team.teamSlot}</span><b>${escapeHtml(team.teamName)}</b><small>${formatDate(team.createdAt)}</small></div><span class="status ${team.status}">${statusLabel(team.status)}</span></div>
      <div class="editor-grid">
        <div class="field"><label>TÊN TEAM</label><input data-team-field="teamName" maxlength="40" value="${escapeHtml(team.teamName)}"></div>
        <div class="field"><label>PLAYER NATION MẶC ĐỊNH</label><input data-team-field="playerNation" maxlength="40" value="${escapeHtml(team.playerNation || team.teamName)}"></div>
        <div class="field"><label>CHUYỂN SANG CUSTOM</label><select data-team-field="customId">${customs.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === team.customId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
        <div class="field"><label>MÀU TEAM</label><input data-team-field="color" type="color" value="${escapeHtml(team.color || '#000000')}"></div>
      </div>
      <div class="admin-players">${(team.players || []).map((player, index) => playerRow(player, index)).join('')}</div>
      <button class="button secondary add-player" data-action="add-player" type="button">+ THÊM NGƯỜI CHƠI</button>
      <div class="actions team-actions"><button class="button primary" data-action="save-team">LƯU THAY ĐỔI</button><button class="button danger" data-action="delete-team">XÓA ĐỘI</button></div>
    </article>`).join('');
}

function playerRow(player = {}, index = 0) {
  return `<div class="admin-player"><span>${index + 1}</span><input class="admin-player-id" inputmode="numeric" placeholder="ID game" value="${escapeHtml(player.playerId || '')}"><input class="admin-player-name" maxlength="50" placeholder="Tên ingame" value="${escapeHtml(player.playerName || '')}"><input class="admin-player-nation" maxlength="40" placeholder="PlayerNation (tùy chọn)" value="${escapeHtml(player.playerNation || '')}"><button class="icon-button remove-player" type="button" aria-label="Xóa người chơi">×</button></div>`;
}

async function loadCustoms(preserve = true) {
  if (!appConfig.loaded) appConfig = { ...(await api('/api/config')).data, loaded: true };
  const result = await api('/api/admin/customs');
  customs = result.data;
  if (!preserve || !customs.some(item => item.id === selectedId)) selectedId = customs[0]?.id || '';
  renderCustoms();
  if (selectedId) await loadTeams(); else renderTeams();
}

async function loadTeams() {
  if (!selectedId) { teams = []; exportState = null; renderTeams(); renderSync(); return; }
  const [teamResult, previewResult] = await Promise.all([
    api(`/api/admin/customs/${encodeURIComponent(selectedId)}/teams`),
    api(`/api/admin/export-preview/${encodeURIComponent(selectedId)}?_ts=${Date.now()}`, { cache: 'no-store' })
  ]);
  teams = teamResult.data;
  exportState = previewResult.data;
  renderTeams();
  renderSync();
}

function renderSync() {
  const panel = $('#syncPanel');
  if (!selectedId || !exportState) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.classList.toggle('has-issues', !exportState.ready);
  $('#syncTime').textContent = exportState.latestUpdatedAt ? `Cập nhật gần nhất: ${formatDate(exportState.latestUpdatedAt)}` : 'Chưa có dữ liệu đã lưu';
  $('#syncStats').innerHTML = `
    <div><b>${exportState.totalTeams}</b><span>Team đã lưu</span></div>
    <div><b>${exportState.totalPlayers}</b><span>Player hợp lệ</span></div>
    <div><b>${exportState.rawPlayerCount}</b><span>Player hiện tại</span></div>
    <div><b>${exportState.conflictCount}</b><span>ID xung đột</span></div>`;
  const issues = [
    ...(exportState.conflicts || []).map(conflict => `ID ${conflict.playerId}: ${conflict.teams.map(team => `${team.teamName} (${team.customId})`).join(' ↔ ')}`),
    ...(exportState.errors || []).map(error => `${error.playerId || 'ID trống'} · ${error.team}: ${error.reason}`)
  ];
  $('#syncIssues').innerHTML = issues.length
    ? `<b>CHƯA THỂ XUẤT FILE</b>${issues.map(issue => `<div>${escapeHtml(issue)}</div>`).join('')}`
    : '<span>Dữ liệu hợp lệ và sẵn sàng tải xuống.</span>';
  const players = exportState.players || [];
  $('#exportPreview').innerHTML = players.length ? `
    <div class="export-preview-head"><span>PLAYER ID</span><span>TÊN HIỂN THỊ</span><span>PLAYER NATION</span><span>COLOR</span></div>
    ${players.map(player => `<div class="export-preview-row"><code>${escapeHtml(player.PlayerID)}</code><b>${escapeHtml(player.PlayerNameOverwrite)}</b><span>${escapeHtml(player.PlayerNation)}</span><span><i style="background:${escapeHtml(player.Color)}"></i>${escapeHtml(player.Color)}</span></div>`).join('')}`
    : '<div class="preview-empty">Chưa có player đã lưu trong custom này.</div>';
  $('#exportCustom').disabled = !exportState.ready;
}

function collectTeam(article) {
  return {
    teamName: article.querySelector('[data-team-field="teamName"]').value.trim(),
    playerNation: article.querySelector('[data-team-field="playerNation"]').value.trim(),
    customId: article.querySelector('[data-team-field="customId"]').value,
    color: article.querySelector('[data-team-field="color"]').value,
    players: [...article.querySelectorAll('.admin-player')].map(row => ({
      playerId: row.querySelector('.admin-player-id').value.trim(),
      playerName: row.querySelector('.admin-player-name').value.trim(),
      playerNation: row.querySelector('.admin-player-nation').value.trim()
    }))
  };
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginButton');
  button.disabled = true;
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#adminPassword').value }) });
    $('#adminPassword').value = '';
    showDashboard();
    await loadCustoms(false);
    showNotice(result.message);
  } catch (error) { showNotice(error.message, 'bad', $('#loginNotice')); }
  finally { button.disabled = false; }
});

$('#togglePassword').addEventListener('click', () => {
  const input = $('#adminPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  customs = []; teams = []; selectedId = ''; showLogin();
});

$('#refreshButton').addEventListener('click', async () => {
  try { await loadCustoms(); showNotice('Dữ liệu đã được làm mới.'); }
  catch (error) { showNotice(error.message, 'bad'); }
});

$('#addCustomForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#newCustom').value.trim();
  try {
    const result = await api('/api/admin/customs', { method: 'POST', body: JSON.stringify({ name, teamRegion: name }) });
    $('#newCustom').value = '';
    selectedId = result.data.id;
    await loadCustoms();
    showNotice(result.message);
  } catch (error) { showNotice(error.message, 'bad'); }
});

$('#customAdminList').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  const card = event.target.closest('[data-custom-id]');
  if (!button || !card) return;
  const id = card.dataset.customId;
  const action = button.dataset.action;
  try {
    if (action === 'select') { selectedId = id; renderCustoms(); await loadTeams(); return; }
    const custom = customs.find(item => item.id === id);
    if (action === 'save' || action === 'toggle') {
      const body = {
        teamRegion: card.querySelector('[data-field="teamRegion"]').value,
        color: card.querySelector('[data-field="color"]').value,
        locked: action === 'toggle' ? !custom.locked : custom.locked
      };
      const result = await api(`/api/admin/customs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
      await loadCustoms(); showNotice(result.message); return;
    }
    if (action === 'delete') {
      const warning = custom.teamCount ? `Custom ${custom.name} đang có ${custom.teamCount} đội. Xóa custom sẽ xóa toàn bộ dữ liệu đội. Tiếp tục?` : `Xóa custom ${custom.name}?`;
      if (!confirm(warning)) return;
      await api(`/api/admin/customs/${encodeURIComponent(id)}?confirm=yes`, { method: 'DELETE' });
      if (selectedId === id) selectedId = '';
      await loadCustoms(false); showNotice('Đã xóa custom và tạo bản sao lưu.');
    }
  } catch (error) { showNotice(error.message, 'bad'); }
});

$('#teamList').addEventListener('click', async event => {
  const remove = event.target.closest('.remove-player');
  if (remove) {
    const container = remove.closest('.admin-players');
    if (container.children.length <= 1) return showNotice('Team phải có ít nhất 1 người chơi.', 'bad');
    if (!confirm('Xóa người chơi này khỏi biểu mẫu? Thay đổi chỉ được lưu khi bấm “Lưu thay đổi”.')) return;
    remove.closest('.admin-player').remove();
    [...container.children].forEach((row, index) => { row.firstElementChild.textContent = index + 1; });
    return;
  }
  const button = event.target.closest('[data-action]');
  const article = event.target.closest('[data-team-id]');
  if (!button || !article) return;
  const id = article.dataset.teamId;
  const action = button.dataset.action;
  try {
    if (action === 'add-player') {
      const container = article.querySelector('.admin-players');
      if (container.children.length >= appConfig.maxPlayersPerTeam) return showNotice(`Tối đa ${appConfig.maxPlayersPerTeam} người chơi.`, 'bad');
      container.insertAdjacentHTML('beforeend', playerRow({}, container.children.length));
      return;
    }
    if (action === 'save-team') {
      const target = article.querySelector('[data-team-field="customId"]').value;
      const result = await api(`/api/admin/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(collectTeam(article)) });
      await loadCustoms();
      showNotice(target === selectedId ? result.message : `${result.message} Đội đã được chuyển custom.`);
      return;
    }
    if (action === 'delete-team') {
      if (!confirm('Xóa vĩnh viễn đội này? Hệ thống sẽ tạo bản sao lưu trước khi xóa.')) return;
      const result = await api(`/api/admin/teams/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadCustoms(); showNotice(result.message);
    }
  } catch (error) { showNotice(error.message, 'bad'); }
});

function parseBulkLines() {
  const errors = [];
  const parsed = $('#bulkInput').value.split(/\r?\n/).map((raw, index) => {
    const line = raw.trim();
    if (!line) return null;
    const ids = [...line.matchAll(/\d{5,}/g)];
    if (!ids.length) { errors.push(`Dòng ${index + 1}: không tìm thấy ID.`); return null; }
    const teamName = line.slice(0, ids[0].index).replace(/[\s\-–—|]+$/g, '').trim();
    if (teamName.length < 2) { errors.push(`Dòng ${index + 1}: thiếu tên team trước ID đầu tiên.`); return null; }
    const players = ids.map((match, playerIndex) => {
      const end = playerIndex + 1 < ids.length ? ids[playerIndex + 1].index : line.length;
      const playerName = line.slice(match.index + match[0].length, end).replace(/^[\s\-–—|.,:]+|[\s\-–—|.,:]+$/g, '').trim();
      return { playerId: match[0], playerName };
    });
    players.forEach((player, playerIndex) => { if (!player.playerName) errors.push(`Dòng ${index + 1}, ID ${player.playerId}: thiếu tên ingame.`); if (!Number.isSafeInteger(Number(player.playerId))) errors.push(`Dòng ${index + 1}: ID vượt giới hạn an toàn.`); });
    if (players.length > appConfig.maxPlayersPerTeam) errors.push(`Dòng ${index + 1}: vượt quá ${appConfig.maxPlayersPerTeam} người chơi.`);
    return { teamName, players };
  }).filter(Boolean);
  return { parsed, errors };
}

function renderBulkPreview() {
  $('#bulkPreview').innerHTML = bulkTeams.map((team, teamIndex) => `
    <div class="bulk-team" data-bulk-index="${teamIndex}"><div class="field"><label>TÊN TEAM</label><input class="bulk-team-name" maxlength="40" value="${escapeHtml(team.teamName)}"></div><div class="bulk-players">${team.players.map((player, index) => `<div class="admin-player"><span>${index + 1}</span><input class="admin-player-id" value="${escapeHtml(player.playerId)}"><input class="admin-player-name" value="${escapeHtml(player.playerName)}"></div>`).join('')}</div></div>`).join('');
}

$('#parseBulk').addEventListener('click', () => {
  if (!selectedId) return showNotice('Hãy chọn custom trước khi đọc danh sách.', 'bad');
  const result = parseBulkLines();
  bulkTeams = result.parsed;
  $('#bulkErrors').innerHTML = result.errors.map(error => `<div>${escapeHtml(error)}</div>`).join('');
  renderBulkPreview();
  $('#importBulk').disabled = Boolean(result.errors.length || !bulkTeams.length);
  showNotice(result.errors.length ? `Có ${result.errors.length} lỗi. Hãy sửa dữ liệu nguồn rồi đọc lại.` : `Đã đọc ${bulkTeams.length} team. Kiểm tra bản xem trước trước khi nạp.`, result.errors.length ? 'bad' : 'ok');
});

$('#importBulk').addEventListener('click', async () => {
  const editable = [...$('#bulkPreview').querySelectorAll('.bulk-team')].map(card => ({
    teamName: card.querySelector('.bulk-team-name').value.trim(),
    players: [...card.querySelectorAll('.admin-player')].map(row => ({ playerId: row.querySelector('.admin-player-id').value.trim(), playerName: row.querySelector('.admin-player-name').value.trim() }))
  }));
  if (!confirm(`Nạp ${editable.length} team vào custom ${selectedId}?`)) return;
  try {
    const result = await api('/api/admin/import', { method: 'POST', body: JSON.stringify({ customId: selectedId, teams: editable }) });
    bulkTeams = []; $('#bulkInput').value = ''; $('#bulkPreview').innerHTML = ''; $('#bulkErrors').innerHTML = ''; $('#importBulk').disabled = true;
    await loadCustoms(); showNotice(result.message);
  } catch (error) { showNotice(error.message, 'bad'); }
});

async function download(path) {
  const exportUrl = `${path}${path.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
  const response = await fetch(exportUrl, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (!response.ok) {
    const result = await response.json();
    const conflictText = result.conflicts?.length
      ? ` ${result.conflicts.map(conflict => `ID ${conflict.playerId}: ${conflict.teams.map(team => `${team.teamName} (${team.customId})`).join(' ↔ ')}`).join('; ')}`
      : '';
    throw new Error((result.message || 'Không xuất được JSON.') + conflictText);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'PlayerNameOverwrite.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice('Đã tải PlayerNameOverwrite.json.');
  await loadTeams();
}

$('#exportCustom').addEventListener('click', () => download(`/api/admin/export/${encodeURIComponent(selectedId)}`).catch(error => showNotice(error.message, 'bad')));
$('#exportAll').addEventListener('click', () => download('/api/admin/export-all').catch(error => showNotice(error.message, 'bad')));
$('#clearCustom').addEventListener('click', async () => {
  if (!selectedId || !confirm(`Xóa toàn bộ team trong custom ${selectedId}? Dữ liệu sẽ được sao lưu trước.`)) return;
  try { const result = await api(`/api/admin/customs/${encodeURIComponent(selectedId)}/teams`, { method: 'DELETE' }); await loadCustoms(); showNotice(result.message); }
  catch (error) { showNotice(error.message, 'bad'); }
});

(async function init() {
  try { await api('/api/admin/session'); showDashboard(); await loadCustoms(false); }
  catch { showLogin(); }
})();
