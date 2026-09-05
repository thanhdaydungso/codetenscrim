'use strict';

const $ = selector => document.querySelector(selector);
const memberList = $('#memberList');
const notice = $('#notice');
let currentCustom = null;
let config = { maxPlayersPerTeam: 6 };
let activeEditToken = '';
let busy = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function customIdFromUrl() {
  const match = location.pathname.match(/^\/custom\/([^/]+)/);
  return match ? decodeURIComponent(match[1]).toUpperCase() : new URLSearchParams(location.search).get('custom')?.toUpperCase();
}

function showNotice(message, type = 'ok', html = false) {
  notice.className = `notice show ${type}`;
  if (html) notice.innerHTML = message; else notice.textContent = message;
  notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const detail = result.errors?.length ? ` ${result.errors.join(' ')}` : '';
    throw new Error((result.message || 'Yêu cầu thất bại.') + detail);
  }
  return result;
}

function addMember(player = {}) {
  if (memberList.children.length >= config.maxPlayersPerTeam) return showNotice(`Tối đa ${config.maxPlayersPerTeam} thành viên.`, 'bad');
  const row = document.createElement('div');
  row.className = 'member-row';
  row.innerHTML = `
    <span class="member-number">${memberList.children.length + 1}</span>
    <div class="field"><label>ID GAME *</label><input class="player-id" inputmode="numeric" autocomplete="off" placeholder="992836236" value="${escapeHtml(player.playerId || '')}"></div>
    <div class="field"><label>TÊN INGAME *</label><input class="player-name" maxlength="50" autocomplete="off" placeholder="NVT.KHADA" value="${escapeHtml(player.playerName || '')}"></div>
    <button class="icon-button remove-member" type="button" aria-label="Xóa thành viên">×</button>`;
  memberList.appendChild(row);
  renumber();
}

function renumber() {
  [...memberList.children].forEach((row, index) => { row.querySelector('.member-number').textContent = index + 1; });
  $('#addMember').disabled = memberList.children.length >= config.maxPlayersPerTeam;
}

function collectTeam() {
  return {
    customId: currentCustom.id,
    teamName: $('#teamName').value.trim(),
    players: [...memberList.querySelectorAll('.member-row')].map(row => ({
      playerId: row.querySelector('.player-id').value.trim(),
      playerName: row.querySelector('.player-name').value.trim()
    }))
  };
}

function validateClient(team) {
  const errors = [];
  if (team.teamName.length < 2 || team.teamName.length > 40) errors.push('Tên team phải có từ 2 đến 40 ký tự.');
  if (!team.players.length) errors.push('Phải có ít nhất 1 thành viên.');
  const seen = new Set();
  team.players.forEach((player, index) => {
    if (!/^\d+$/.test(player.playerId)) errors.push(`Thành viên ${index + 1}: ID chỉ được chứa số.`);
    else if (!Number.isSafeInteger(Number(player.playerId))) errors.push(`Thành viên ${index + 1}: ID vượt giới hạn an toàn.`);
    if (!player.playerName) errors.push(`Thành viên ${index + 1}: thiếu tên ingame.`);
    if (seen.has(player.playerId)) errors.push(`ID ${player.playerId} bị trùng trong đội.`);
    seen.add(player.playerId);
  });
  return errors;
}

function parseQuickLine(raw, lineNumber) {
  const line = raw.trim();
  if (!line) return null;
  const matches = [...line.matchAll(/\d+/g)].filter(match => match[0].length >= 5);
  if (matches.length !== 1) return { error: matches.length ? 'Có nhiều ID, mỗi dòng chỉ nhập một người.' : 'Không tìm thấy ID dạng số.', lineNumber, raw };
  const match = matches[0];
  const id = match[0];
  const name = `${line.slice(0, match.index)} ${line.slice(match.index + id.length)}`
    .replace(/^[\s.|,:;\-–—]+|[\s.|,:;\-–—]+$/g, '').trim();
  if (!name) return { error: 'Không tìm thấy tên ingame.', lineNumber, raw };
  if (!Number.isSafeInteger(Number(id))) return { error: 'ID vượt Number.MAX_SAFE_INTEGER.', lineNumber, raw };
  return { playerId: id, playerName: name, lineNumber };
}

function parseQuick() {
  const lines = $('#quickInput').value.split(/\r?\n/);
  let teamName = '';
  let start = 0;
  const first = lines.findIndex(line => line.trim());
  if (first >= 0 && !/\d{5,}/.test(lines[first])) { teamName = lines[first].trim(); start = first + 1; }
  const parsed = lines.map((line, index) => index < start ? null : parseQuickLine(line, index + 1)).filter(Boolean);
  const errors = parsed.filter(item => item.error);
  const players = parsed.filter(item => !item.error);
  const duplicateIds = new Set();
  const seen = new Set();
  players.forEach(player => { if (seen.has(player.playerId)) duplicateIds.add(player.playerId); seen.add(player.playerId); });
  duplicateIds.forEach(id => errors.push({ lineNumber: '—', raw: id, error: 'ID bị trùng trong ô nhập nhanh.' }));
  if (errors.length) {
    $('#parseErrors').innerHTML = errors.map(item => `<div>Dòng ${item.lineNumber}: ${escapeHtml(item.raw)} — ${escapeHtml(item.error)}</div>`).join('');
    return showNotice(`Có ${errors.length} dòng không đọc được. Dữ liệu chưa được điền.`, 'bad');
  }
  if (!players.length) return showNotice('Ô nhập nhanh chưa có thành viên hợp lệ.', 'bad');
  if (players.length > config.maxPlayersPerTeam) return showNotice(`Danh sách vượt tối đa ${config.maxPlayersPerTeam} thành viên.`, 'bad');
  if (teamName) $('#teamName').value = teamName.slice(0, 40);
  memberList.innerHTML = '';
  players.forEach(addMember);
  $('#parseErrors').innerHTML = '';
  showNotice(`Đã đọc ${players.length} thành viên và điền vào biểu mẫu.`);
}

async function submit(isUpdate) {
  if (busy) return;
  const team = collectTeam();
  const errors = validateClient(team);
  if (errors.length) return showNotice(errors.join(' '), 'bad');
  if (isUpdate && !activeEditToken) return showNotice('Hãy nhập và tải mã chỉnh sửa trước khi cập nhật.', 'bad');
  busy = true;
  $('#submitButton').disabled = true;
  $('#updateButton').disabled = true;
  try {
    const result = await api(isUpdate ? `/api/submissions/${activeEditToken}` : '/api/submissions', {
      method: isUpdate ? 'PUT' : 'POST', body: JSON.stringify(team)
    });
    if (!isUpdate) {
      activeEditToken = result.data.editToken;
      $('#editToken').value = activeEditToken;
      localStorage.setItem(`editToken:${currentCustom.id}`, activeEditToken);
      showNotice(`<b>${escapeHtml(result.message)}</b><br>Mã chỉnh sửa của đội: <code>${escapeHtml(activeEditToken)}</code><br><small>Hãy lưu mã này để cập nhật thông tin sau này.</small>`, 'ok', true);
    } else showNotice(result.message);
  } catch (error) { showNotice(error.message, 'bad'); }
  finally {
    busy = false;
    $('#submitButton').disabled = false;
    $('#updateButton').disabled = false;
  }
}

async function loadEdit() {
  const token = $('#editToken').value.trim();
  if (!/^[a-f0-9]{48}$/.test(token)) return showNotice('Mã chỉnh sửa không đúng định dạng.', 'bad');
  try {
    const result = await api(`/api/submissions/${token}`);
    if (result.data.team.customId !== currentCustom.id) return showNotice(`Mã này thuộc custom ${result.data.team.customId}.`, 'bad');
    activeEditToken = token;
    $('#teamName').value = result.data.team.teamName;
    memberList.innerHTML = '';
    result.data.team.players.forEach(addMember);
    showNotice('Đã tải thông tin đội. Bạn có thể chỉnh sửa rồi bấm “Cập nhật thông tin”.');
  } catch (error) { showNotice(error.message, 'bad'); }
}

memberList.addEventListener('click', event => {
  const button = event.target.closest('.remove-member');
  if (!button) return;
  if (memberList.children.length <= 1) return showNotice('Đội phải có ít nhất 1 thành viên.', 'bad');
  button.closest('.member-row').remove();
  renumber();
});
$('#addMember').addEventListener('click', () => addMember());
$('#parseQuick').addEventListener('click', parseQuick);
$('#teamForm').addEventListener('submit', event => { event.preventDefault(); submit(false); });
$('#updateButton').addEventListener('click', () => submit(true));
$('#loadEdit').addEventListener('click', loadEdit);

(async function init() {
  const id = customIdFromUrl();
  if (!id) return showNotice('Chọn một custom để nhập danh sách team.', 'bad');
  try {
    const [configResult, customResult] = await Promise.all([api('/api/config'), api(`/api/customs/${encodeURIComponent(id)}`)]);
    config = configResult.data;
    currentCustom = customResult.data;
    $('#pageTitle').textContent = `THÔNG TIN CUSTOM ${currentCustom.name}`;
    document.title = `Custom ${currentCustom.name} · Cổng quản lý code tên`;
    $('#memberLimit').textContent = `Tối đa ${config.maxPlayersPerTeam} người`;
    const labels = { open: 'CÒN CHỖ', full: 'ĐÃ ĐẦY', locked: 'ĐÃ KHÓA' };
    $('#customAvailability').textContent = labels[currentCustom.status];
    $('#customAvailability').className = `status ${currentCustom.status}`;
    $('#formShell').hidden = false;
    addMember();
    const saved = localStorage.getItem(`editToken:${currentCustom.id}`);
    if (saved) $('#editToken').value = saved;
    if (!currentCustom.available) {
      $('#submitButton').disabled = true;
      showNotice('Custom đã bị BTC khóa.', 'bad');
    }
  } catch (error) { showNotice(error.message, 'bad'); }
})();
