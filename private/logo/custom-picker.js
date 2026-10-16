'use strict';
(() => {
  const button = document.getElementById('pickCustom');
  const picker = document.getElementById('customPicker');
  const select = document.getElementById('playnameCustom');
  const choice = document.getElementById('customChoice');
  let loading = false, loaded = false;
  async function loadCustoms() {
    if (loading || loaded) return;
    loading = true;
    select.disabled = true;
    select.replaceChildren(new Option('Đang tải custom...', ''));
    try {
      const response = await fetch('/api/admin/customs', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401 || response.redirected) throw new Error('Phiên đăng nhập đã hết. Hãy đăng nhập lại trang quản trị.');
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.data)) throw new Error(result.message || 'Không tải được custom.');
      select.replaceChildren(new Option(result.data.length ? 'Chọn custom playname' : 'Chưa có custom', ''));
      for (const custom of result.data) select.add(new Option(custom.name + ' (' + custom.playerCount + ' player)', custom.id));
      loaded = true;
      choice.textContent = result.data.length ? 'Chưa chọn custom xuất kèm.' : 'Chưa có custom. Hãy tạo custom trong trang quản trị.';
    } catch (error) {
      select.replaceChildren(new Option('Không tải được custom', ''));
      choice.textContent = error.message + ' Bấm Chọn custom để thử lại.';
    } finally {
      loading = false;
      select.disabled = !loaded;
    }
  }
  select.addEventListener('change', () => {
    choice.textContent = select.value ? 'Xuất kèm: ' + select.selectedOptions[0].textContent : 'Chưa chọn custom xuất kèm.';
    document.dispatchEvent(new Event('logo-custom-change'));
  });
  button.addEventListener('click', () => {
    picker.hidden = loaded ? !picker.hidden : false;
    button.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) { loadCustoms(); select.focus(); }
  });
  loadCustoms();
})();