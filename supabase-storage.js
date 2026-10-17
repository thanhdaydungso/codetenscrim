'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');

class SupabaseStorage {
  constructor({ url, secret, fetchImpl = fetch }) {
    if (!url || !secret) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1') throw new Error('SUPABASE_URL phải dùng HTTPS.');
    this.url = parsed.origin;
    this.secret = secret;
    this.fetch = fetchImpl;
    this.context = new AsyncLocalStorage();
  }
  run(action) { return this.context.run({}, action); }
  async rpc(name, body = {}) {
    let response;
    try {
      response = await this.fetch(this.url + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { apikey: this.secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw Object.assign(new Error('Không kết nối được Supabase. Dữ liệu chưa được xác nhận lưu; hãy tải lại trước khi thử lại.'), { status: 503 });
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const logoErrors = {
        LOGO_NOT_FOUND:[404,'Bảng logo không tồn tại hoặc đã hết hạn 2 giờ.'], LOGO_CLOSED:[409,'Đã đủ logo. Link nhận logo đã khóa.'], LOGO_AUTOMATIC:[405,'Trạng thái link được điều khiển tự động.'],
        LOGO_ASSIGNED:[409,'Đội này đã có logo. Hãy tải lại bảng.'], LOGO_BAD_SLOT:[400,'Đội không hợp lệ.'],
        LOGO_FULL:[413,'Bảng đã đầy. Hãy liên hệ BTC.']
      };
      const logoError=logoErrors[detail.message];
      if(logoError)throw Object.assign(new Error(logoError[1]),{status:logoError[0]});
      const conflict = String(detail.message).includes('SCRIM_CONFLICT');
      if(name === 'scrim_logo_board' && detail.code === 'PGRST202') throw Object.assign(new Error('Chạy supabase/logo-boards.sql trong SQL Editor để bật backup logo.'),{status:503});
      const missing = detail.code === 'PGRST202' || detail.code === '42P01';
      const message = conflict ? 'Dữ liệu vừa thay đổi ở phiên khác. Hãy tải lại và thử lại.'
        : missing ? 'Chưa tạo bảng Supabase. Chạy supabase/schema.sql trong SQL Editor.'
        : 'Supabase từ chối thao tác lưu/đọc dữ liệu (HTTP ' + response.status + ').';
      throw Object.assign(new Error(message), { status: conflict ? 409 : 503 });
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  validate(state) {
    if (!state || !Array.isArray(state.customs) || !Array.isArray(state.teams) || !Number.isSafeInteger(state.revision)) {
      throw Object.assign(new Error('Dữ liệu Supabase chưa khởi tạo hoặc không hợp lệ.'), { status: 503 });
    }
    return state;
  }
  async initialize(customs, teams) {
    return this.validate(await this.rpc('scrim_initialize', { initial_customs: customs, initial_teams: teams }));
  }
  async snapshot() {
    const scope = this.context.getStore();
    if (scope?.state) return scope.state;
    const state = this.validate(await this.rpc('scrim_read'));
    if (scope) scope.state = state;
    return state;
  }
  refresh() { const scope = this.context.getStore(); if (scope) delete scope.state; }
  async read(collection) { return structuredClone((await this.snapshot())[collection]); }
  async write(collection, items) {
    const state = await this.snapshot();
    const next = this.validate(await this.rpc('scrim_write', { expected_revision: state.revision, collection, items }));
    const scope = this.context.getStore();
    if (scope) scope.state = next;
  }
  async backup(label) {
    const state = await this.snapshot();
    await this.rpc('scrim_backup', { expected_revision: state.revision, backup_label: label });
  }
}
module.exports = { SupabaseStorage };
