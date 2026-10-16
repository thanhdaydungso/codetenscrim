'use strict';

const list = document.querySelector('#customList');
const notice = document.querySelector('#notice');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function showNotice(message, type = 'bad') {
  notice.textContent = message;
  notice.className = `notice show ${type}`;
}

async function getJson(url) {
  document.dispatchEvent(new Event('ui-request-start'));
  try {
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Không tải được dữ liệu.');
    return result.data;
  } finally { document.dispatchEvent(new Event('ui-request-end')); }
}

let allCustoms = [];
let statusFilter = 'all';
function render(customs) {
  document.querySelector('#customCount').textContent = customs.length;
  document.querySelector('#openCount').textContent = customs.filter(item => item.status === 'open').length;
  const query = document.querySelector('#customSearch').value.trim().toLocaleLowerCase('vi');
  const filtered = customs.filter(item => (statusFilter === 'all' || item.status === statusFilter) && (item.name + ' ' + item.id).toLocaleLowerCase('vi').includes(query));
  document.querySelector('#searchSummary').textContent = filtered.length + ' / ' + customs.length + ' custom';
  if (!customs.length) {
    list.innerHTML = '<div class="empty-state">BTC chưa tạo custom nào.</div>';
    return;
  }
  if (!filtered.length) { list.innerHTML = '<div class="empty-state">Không tìm thấy custom. Thử tên khác hoặc đổi bộ lọc.</div>'; return; }
  list.innerHTML = filtered.map(custom => {
    const labels = { open: 'Còn chỗ', full: 'Đã đầy', locked: 'Đã khóa' };
    const disabled = !custom.available;
    const content = `
      <span class="custom-glow" style="--custom-color:${escapeHtml(custom.color)}"></span>
      <span class="slot-label">CUSTOM MATCH</span>
      <strong>${escapeHtml(custom.name)}</strong>
      <span class="capacity"><i style="width:${Math.min(100, custom.teamCount / custom.capacity * 100)}%;--custom-color:${escapeHtml(custom.color)}"></i></span>
      <span class="custom-meta"><b>${custom.teamCount}/${custom.capacity} đội</b><em class="status ${custom.status}">${labels[custom.status]}</em></span>`;
    return disabled
      ? `<div class="custom-card disabled" aria-disabled="true">${content}</div>`
      : `<a class="custom-card" href="/custom/${encodeURIComponent(custom.id)}">${content}</a>`;
  }).join('');
}

Promise.all([getJson('/api/config'), getJson('/api/customs')])
  .then(([config, customs]) => {
    document.querySelector('#siteName').textContent = config.siteName;
    document.title = config.siteName;
    document.querySelector('#memberCapacity').textContent = config.maxPlayersPerTeam;
    allCustoms = customs;
    render(customs);
  })
  .catch(error => {
    list.innerHTML = '<div class="empty-state">Không thể tải danh sách custom.</div>';
    showNotice(error.message);
  });

document.querySelector('#customSearch').addEventListener('input', () => render(allCustoms));
document.querySelectorAll('[data-status-filter]').forEach(button => button.addEventListener('click', () => { statusFilter = button.dataset.statusFilter; document.querySelectorAll('[data-status-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(allCustoms); }));
