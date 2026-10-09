'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { nextVietnamReset } = require('./reset-schedule');

// Đọc .env nếu có (không cần thư viện ngoài)
try {
  const envFile = path.join(__dirname, '.env');
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
} catch {}

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = String(process.env.ADMIN_KEY || 'change-me');
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const TEAM_FILE = path.join(DATA_DIR, 'submissions.json');
const CUSTOM_FILE = path.join(DATA_DIR, 'customs.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const SESSION_TTL = 12 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const sessions = new Map();
let writeQueue = Promise.resolve();

function defaultConfig() {
  return {
    siteName: 'CỔNG QUẢN LÝ CODE TÊN',
    defaultRegion: 'HV',
    teamSlotCount: 9999,
    maxPlayersPerTeam: 6,
    defaultColor: '#FFFFFF'
  };
}

function initialCustoms() {
  const now = new Date().toISOString();
  return ['MP', 'XN', 'HV', 'YN'].map((id, index) => ({
    id,
    name: id,
    teamRegion: id,
    color: '#FFFFFF',
    locked: false,
    createdAt: now,
    updatedAt: now
  }));
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  for (const [file, fallback] of [[TEAM_FILE, []], [CUSTOM_FILE, initialCustoms()]]) {
    try { await fsp.access(file); }
    catch { await writeJsonAtomic(file, fallback); }
  }
  const cfg = config();
  const storedTeams = readJson(TEAM_FILE, []);
  const storedCustoms = readJson(CUSTOM_FILE, initialCustoms());
  let changed = false;
  const migratedTeams = storedTeams.map((team, index) => {
    const customId = normalizeCustomId(team.customId || team.region || cfg.defaultRegion || 'HV');
    const now = new Date().toISOString();
    const storedStatus = ['pending', 'approved', 'rejected'].includes(team.status) ? team.status : 'approved';
    const migrated = {
      ...team,
      id: team.id || crypto.randomUUID(),
      editToken: /^[a-f0-9]{48}$/.test(team.editToken || '') ? team.editToken : crypto.randomBytes(24).toString('hex'),
      teamName: cleanText(team.teamName, 40) || `TEAM ${index + 1}`,
      customId,
      teamSlot: Number.isInteger(Number(team.teamSlot)) ? Number(team.teamSlot) : index + 1,
      status: storedStatus === 'pending' ? 'approved' : storedStatus,
      players: (team.players || []).map(player => ({ ...player, playerId: String(player.playerId ?? '').trim(), playerName: cleanText(player.playerName, 50) })),
      createdAt: team.createdAt || now,
      updatedAt: team.updatedAt || team.createdAt || now
    };
    if (!team.customId || !team.editToken || !team.createdAt || !['approved', 'rejected'].includes(team.status) || typeof team.players?.[0]?.playerId === 'number') changed = true;
    return migrated;
  });
  const missingIds = [...new Set(migratedTeams.map(team => team.customId))].filter(id => id && !storedCustoms.some(custom => custom.id === id));
  const legacyColors = { MP: '#8B3FD1', XN: '#D1493F', HV: '#C62A67', YN: '#E08B2D' };
  const updatedCustoms = storedCustoms.map(custom => {
    if (custom.whiteDefaultMigrated) return custom;
    changed = true;
    const color = String(custom.color || '').toUpperCase();
    const wasDefault = color === legacyColors[custom.id] || color === '#000000' || !color;
    return { ...custom, color: wasDefault ? '#FFFFFF' : custom.color, whiteDefaultMigrated: true };
  });
  const migratedCustoms = [...updatedCustoms, ...missingIds.map(id => {
    changed = true;
    const now = new Date().toISOString();
    return { id, name: id, teamRegion: id, color: cfg.defaultColor, locked: false, createdAt: now, updatedAt: now };
  })];
  if (changed) {
    await backupFiles('schema-migration');
    await writeJsonAtomic(TEAM_FILE, migratedTeams);
    await writeJsonAtomic(CUSTOM_FILE, migratedCustoms);
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    console.error(`Không đọc được ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}

function withWriteLock(action) {
  const next = writeQueue.then(action, action);
  writeQueue = next.catch(() => {});
  return next;
}

async function backupFiles(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  for (const file of [TEAM_FILE, CUSTOM_FILE]) {
    try {
      await fsp.copyFile(file, path.join(BACKUP_DIR, `${stamp}-${label}-${path.basename(file)}`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function config() {
  return { ...defaultConfig(), ...readJson(CONFIG_FILE, {}) };
}

function apiSuccess(res, status, message, data = {}) {
  return json(res, status, { success: true, message, data });
}

function apiError(res, status, message, errors = []) {
  return json(res, status, { success: false, message, errors });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function json(res, status, value, headers = {}) {
  return send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'], ...headers });
}

function parseBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('Dữ liệu gửi lên quá lớn.');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error('JSON không hợp lệ.');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 100) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max);
}

function normalizeColor(value, fallback = '#FFFFFF') {
  const color = cleanText(value, 7);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeCustomId(value) {
  return cleanText(value, 24)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
}

function publicCustom(custom, teams, cfg) {
  const active = teams.filter(team => team.customId === custom.id && team.status !== 'rejected');
  return {
    ...custom,
    teamCount: active.length,
    playerCount: active.reduce((sum, team) => sum + (team.players?.length || 0), 0),
    capacity: cfg.teamSlotCount,
    available: !custom.locked,
    status: custom.locked ? 'locked' : 'open'
  };
}

function validatePlayers(input, maxPlayers) {
  const errors = [];
  const players = Array.isArray(input) ? input : [];
  if (players.length < 1) errors.push('Phải có ít nhất 1 thành viên.');
  if (players.length > maxPlayers) errors.push(`Một đội tối đa ${maxPlayers} thành viên.`);
  const seen = new Set();
  const normalized = [];
  players.forEach((player, index) => {
    const playerName = cleanText(player?.playerName, 50);
    const playerId = String(player?.playerId ?? '').trim();
    const playerNation = cleanText(player?.playerNation, 40);
    if (!playerName) errors.push(`Thành viên ${index + 1}: thiếu tên ingame.`);
    if (!/^\d+$/.test(playerId)) errors.push(`Thành viên ${index + 1}: ID game chỉ được chứa số.`);
    else if (!Number.isSafeInteger(Number(playerId))) errors.push(`Thành viên ${index + 1}: ID vượt Number.MAX_SAFE_INTEGER.`);
    if (seen.has(playerId)) errors.push(`Thành viên ${index + 1}: ID ${playerId} bị trùng trong đội.`);
    seen.add(playerId);
    if (playerName && /^\d+$/.test(playerId) && Number.isSafeInteger(Number(playerId)) && !normalized.some(p => p.playerId === playerId)) {
      normalized.push({ playerId, playerName, ...(playerNation ? { playerNation } : {}) });
    }
  });
  return { errors, players: normalized };
}

function validateTeamInput(input, cfg, options = {}) {
  const teamName = cleanText(input.teamName, 40);
  const customId = normalizeCustomId(input.customId || options.customId);
  const contact = cleanText(input.contact, 100);
  const note = cleanText(input.note, 300);
  const colorInput = cleanText(input.color, 7);
  const color = /^#[0-9a-fA-F]{6}$/.test(colorInput) ? normalizeColor(colorInput, '#FFFFFF') : '';
  const playerResult = validatePlayers(input.players, cfg.maxPlayersPerTeam);
  const errors = [...playerResult.errors];
  if (teamName.length < 2) errors.push('Tên team phải có từ 2 đến 40 ký tự.');
  if (!customId) errors.push('Chưa chọn custom.');
  return {
    errors,
    value: { teamName, customId, contact, note, color, players: playerResult.players }
  };
}

function conflictsForTeam(value, teams, ignoreId = '') {
  const peers = teams.filter(team => team.id !== ignoreId && team.customId === value.customId && team.status !== 'rejected');
  const errors = [];
  if (peers.some(team => team.teamName.localeCompare(value.teamName, 'vi', { sensitivity: 'accent' }) === 0)) {
    errors.push(`Tên team “${value.teamName}” đã tồn tại trong custom.`);
  }
  const owners = new Map();
  peers.forEach(team => (team.players || []).forEach(player => owners.set(player.playerId, team.teamName)));
  value.players.forEach(player => {
    if (owners.has(player.playerId)) errors.push(`ID ${player.playerId} đã thuộc team ${owners.get(player.playerId)} trong custom.`);
  });
  return errors;
}

function nextSlot(customId, teams, cfg, ignoreId = '') {
  const used = new Set(teams.filter(t => t.id !== ignoreId && t.customId === customId && t.status !== 'rejected').map(t => Number(t.teamSlot)));
  for (let slot = 1; slot <= cfg.teamSlotCount; slot += 1) if (!used.has(slot)) return slot;
  return null;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function adminSession(req) {
  const token = parseCookies(req).btc_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

function sessionCookie(req, token, maxAge = Math.floor(SESSION_TTL / 1000)) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `btc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function prepareExport(custom, teams, cfg) {
  const approved = teams
    .filter(team => team.customId === custom.id && team.status === 'approved')
    .sort((left, right) => Number(left.teamSlot) - Number(right.teamSlot));
  const recordsById = new Map();
  const ownersById = new Map();
  const validationErrors = [];
  let rawPlayerCount = 0;

  for (const team of approved) {
    const latestInTeam = new Map();
    (team.players || []).forEach((player, index) => {
      rawPlayerCount += 1;
      const playerId = String(player?.playerId ?? '').trim();
      const playerName = cleanText(player?.playerName, 50);
      if (!/^\d+$/.test(playerId)) {
        validationErrors.push({ playerId, team: team.teamName, customId: custom.id, reason: 'PlayerID chỉ được chứa chữ số.' });
        return;
      }
      if (!Number.isSafeInteger(Number(playerId))) {
        validationErrors.push({ playerId, team: team.teamName, customId: custom.id, reason: 'PlayerID vượt giới hạn số an toàn của JSON/JavaScript.' });
        return;
      }
      if (!playerName) {
        validationErrors.push({ playerId, team: team.teamName, customId: custom.id, reason: 'Tên ingame đang để trống.' });
        return;
      }
      const updatedAt = Date.parse(player.updatedAt || team.updatedAt || team.createdAt || 0) || 0;
      const candidate = { player, playerId, playerName, team, updatedAt, index };
      const previous = latestInTeam.get(playerId);
      if (!previous || updatedAt > previous.updatedAt || (updatedAt === previous.updatedAt && index > previous.index)) {
        latestInTeam.set(playerId, candidate);
      }
    });

    for (const candidate of latestInTeam.values()) {
      if (!ownersById.has(candidate.playerId)) ownersById.set(candidate.playerId, new Map());
      ownersById.get(candidate.playerId).set(team.id, {
        teamId: team.id,
        teamName: team.teamName,
        customId: custom.id
      });
      const previous = recordsById.get(candidate.playerId);
      if (!previous || candidate.updatedAt >= previous.updatedAt) recordsById.set(candidate.playerId, candidate);
    }
  }

  const conflicts = [...ownersById.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([playerId, owners]) => ({ playerId, teams: [...owners.values()] }));

  const PlayerNameList = [...recordsById.values()].map(({ player, playerId, playerName, team }) => ({
    PlayerID: Number(playerId),
    PlayerNameOverwrite: playerName,
    PlayerNation: cleanText(player.playerNation || team.playerNation || team.teamName, 40),
    Color: normalizeColor(team.color, cfg.defaultColor || '#FFFFFF')
  }));
  const latestTime = [custom.updatedAt, ...approved.map(team => team.updatedAt || team.createdAt)]
    .map(value => Date.parse(value || 0) || 0)
    .reduce((latest, value) => Math.max(latest, value), 0);

  return {
    output: {
      PlayerNameList,
      TeamRegionList: Array.from({ length: 15 }, (_, index) => ({
        TeamID: index + 1,
        TeamRegion: cleanText(custom.teamRegion || custom.name, 30),
        Color: normalizeColor(custom.color, cfg.defaultColor || '#FFFFFF')
      }))
    },
    conflicts,
    validationErrors,
    latestUpdatedAt: latestTime ? new Date(latestTime).toISOString() : null,
    totalTeams: approved.length,
    totalPlayers: PlayerNameList.length,
    rawPlayerCount,
    conflictCount: conflicts.length,
    ready: conflicts.length === 0 && validationErrors.length === 0
  };
}

function buildExport(custom, teams, cfg) {
  return prepareExport(custom, teams, cfg).output;
}

function sendExportError(res, prepared) {
  if (prepared.validationErrors.length) {
    const unsafe = prepared.validationErrors.find(error => error.reason.includes('giới hạn số an toàn'));
    return json(res, 422, {
      success: false,
      message: unsafe ? 'PlayerID vượt giới hạn số an toàn của JSON/JavaScript.' : 'Không thể xuất file vì dữ liệu player chưa hợp lệ.',
      ...(unsafe ? { playerId: unsafe.playerId } : {}),
      errors: prepared.validationErrors
    });
  }
  if (prepared.conflicts.length) {
    return json(res, 409, {
      success: false,
      message: 'Không thể xuất file vì có PlayerID bị trùng.',
      conflicts: prepared.conflicts
    });
  }
  return false;
}

function downloadJson(res, data, custom) {
  const label = cleanText(custom.name || custom.id, 40).replace(/[\/\\"]/g, '-');
  const filename = 'SCRIM ' + label + '.json';
  return send(res, 200, JSON.stringify(data, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="SCRIM ${custom.id}.json"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
}

function serveStatic(req, res, url) {
  let requested = url.pathname;
  if (requested === '/') requested = '/index.html';
  if (/^\/custom\/[^/]+\/?$/.test(requested)) requested = '/custom.html';
  if (requested === '/admin' || requested === '/admin/') requested = '/admin.html';
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return send(res, 403, 'Forbidden');
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return send(res, 404, 'Không tìm thấy trang.');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handlePublicApi(req, res, url, cfg) {
  const teams = readJson(TEAM_FILE, []);
  const customs = readJson(CUSTOM_FILE, initialCustoms());

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return apiSuccess(res, 200, 'Đã tải cấu hình.', {
      siteName: cfg.siteName,
      teamSlotCount: cfg.teamSlotCount,
      maxPlayersPerTeam: cfg.maxPlayersPerTeam,
      defaultColor: cfg.defaultColor
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/customs') {
    return apiSuccess(res, 200, 'Đã tải danh sách custom.', customs.map(item => publicCustom(item, teams, cfg)));
  }

  const customMatch = url.pathname.match(/^\/api\/customs\/([^/]+)$/);
  if (req.method === 'GET' && customMatch) {
    const id = normalizeCustomId(decodeURIComponent(customMatch[1]));
    const custom = customs.find(item => item.id === id);
    if (!custom) return apiError(res, 404, 'Không tìm thấy custom.');
    return apiSuccess(res, 200, 'Đã tải custom.', publicCustom(custom, teams, cfg));
  }

  if (req.method === 'POST' && url.pathname === '/api/submissions') {
    const body = await parseBody(req);
    return withWriteLock(async () => {
      const latestTeams = readJson(TEAM_FILE, []);
      const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
      const checked = validateTeamInput(body, cfg);
      if (checked.errors.length) return apiError(res, 400, 'Thông tin đội chưa hợp lệ.', checked.errors);
      const custom = latestCustoms.find(item => item.id === checked.value.customId);
      if (!custom) return apiError(res, 404, 'Custom không tồn tại.');
      if (custom.locked) return apiError(res, 409, 'Custom đã bị BTC khóa.');
      const slot = nextSlot(custom.id, latestTeams, cfg);
      const conflicts = conflictsForTeam(checked.value, latestTeams);
      if (conflicts.length) return apiError(res, 409, 'Tên team hoặc ID game đã tồn tại.', conflicts);
      const now = new Date().toISOString();
      const team = {
        id: crypto.randomUUID(),
        editToken: crypto.randomBytes(24).toString('hex'),
        ...checked.value,
        teamSlot: slot,
        status: 'approved',
        createdAt: now,
        updatedAt: now
      };
      latestTeams.push(team);
      await writeJsonAtomic(TEAM_FILE, latestTeams);
      return apiSuccess(res, 201, 'Đã lưu code tên thành công.', {
        submissionId: team.id,
        editToken: team.editToken,
        team: { ...team, editToken: undefined }
      });
    });
  }

  const editMatch = url.pathname.match(/^\/api\/submissions\/([a-f0-9]{48})$/);
  if (editMatch && req.method === 'GET') {
    const team = teams.find(item => item.editToken === editMatch[1]);
    if (!team) return apiError(res, 404, 'Mã chỉnh sửa không hợp lệ.');
    const custom = customs.find(item => item.id === team.customId);
    return apiSuccess(res, 200, 'Đã tải thông tin đội.', { team, custom: custom && publicCustom(custom, teams, cfg) });
  }

  if (editMatch && req.method === 'PUT') {
    const body = await parseBody(req);
    return withWriteLock(async () => {
      const latestTeams = readJson(TEAM_FILE, []);
      const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
      const index = latestTeams.findIndex(item => item.editToken === editMatch[1]);
      if (index < 0) return apiError(res, 404, 'Mã chỉnh sửa không hợp lệ.');
      const current = latestTeams[index];
      const custom = latestCustoms.find(item => item.id === current.customId);
      if (!custom || custom.locked) return apiError(res, 409, 'Custom đã bị BTC khóa, không thể cập nhật.');
      const checked = validateTeamInput({ ...body, customId: current.customId }, cfg);
      if (checked.errors.length) return apiError(res, 400, 'Thông tin đội chưa hợp lệ.', checked.errors);
      checked.value.color = current.color || checked.value.color;
      const conflicts = conflictsForTeam(checked.value, latestTeams, current.id);
      if (conflicts.length) return apiError(res, 409, 'Tên team hoặc ID game đã tồn tại.', conflicts);
      let teamSlot = current.teamSlot;
      if (current.status === 'rejected') {
        teamSlot = nextSlot(current.customId, latestTeams, cfg, current.id) || current.teamSlot;
      }
      latestTeams[index] = { ...current, ...checked.value, customId: current.customId, teamSlot, status: 'approved', updatedAt: new Date().toISOString() };
      await writeJsonAtomic(TEAM_FILE, latestTeams);
      return apiSuccess(res, 200, 'Cập nhật thông tin thành công.', { team: latestTeams[index] });
    });
  }

  return false;
}

async function handleAdminApi(req, res, url, cfg) {
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await parseBody(req);
    if (!ADMIN_KEY || !safeEqual(body.key || body.password, ADMIN_KEY)) {
      return apiError(res, 401, 'Mật khẩu quản trị không đúng.');
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL });
    return json(res, 200, { success: true, message: 'Đăng nhập BTC thành công.', data: {} }, { 'Set-Cookie': sessionCookie(req, token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const token = parseCookies(req).btc_session;
    if (token) sessions.delete(token);
    return json(res, 200, { success: true, message: 'Đã đăng xuất.', data: {} }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/session') {
    return adminSession(req)
      ? apiSuccess(res, 200, 'Phiên đăng nhập còn hiệu lực.', { authenticated: true })
      : apiError(res, 401, 'Bạn chưa đăng nhập.');
  }

  if (!adminSession(req)) return apiError(res, 401, 'Phiên đăng nhập đã hết hạn.');

  const teams = readJson(TEAM_FILE, []);
  const customs = readJson(CUSTOM_FILE, initialCustoms());

  if (req.method === 'GET' && url.pathname === '/api/admin/customs') {
    return apiSuccess(res, 200, 'Đã tải dữ liệu quản trị.', customs.map(item => publicCustom(item, teams, cfg)));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/customs') {
    const body = await parseBody(req);
    return withWriteLock(async () => {
      const latest = readJson(CUSTOM_FILE, initialCustoms());
      const name = cleanText(body.name || body.teamRegion, 30);
      const id = normalizeCustomId(body.id || name);
      if (name.length < 2 || !id) return apiError(res, 400, 'Tên custom phải có ít nhất 2 ký tự.');
      if (latest.some(item => item.id === id || item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
        return apiError(res, 409, 'Tên custom đã tồn tại.');
      }
      const now = new Date().toISOString();
      const custom = {
        id,
        name,
        teamRegion: cleanText(body.teamRegion || name, 30),
        color: normalizeColor(body.color, cfg.defaultColor),
        locked: Boolean(body.locked),
        createdAt: now,
        updatedAt: now
      };
      latest.push(custom);
      await writeJsonAtomic(CUSTOM_FILE, latest);
      return apiSuccess(res, 201, 'Đã thêm custom.', custom);
    });
  }

  const customMatch = url.pathname.match(/^\/api\/admin\/customs\/([^/]+)$/);
  if (customMatch && req.method === 'PUT') {
    const id = normalizeCustomId(decodeURIComponent(customMatch[1]));
    const body = await parseBody(req);
    return withWriteLock(async () => {
      const latest = readJson(CUSTOM_FILE, initialCustoms());
      const index = latest.findIndex(item => item.id === id);
      if (index < 0) return apiError(res, 404, 'Không tìm thấy custom.');
      latest[index] = {
        ...latest[index],
        name: cleanText(body.name ?? latest[index].name, 30) || latest[index].name,
        teamRegion: cleanText(body.teamRegion ?? latest[index].teamRegion, 30) || latest[index].teamRegion,
        color: normalizeColor(body.color, latest[index].color),
        locked: body.locked === undefined ? latest[index].locked : Boolean(body.locked),
        updatedAt: new Date().toISOString()
      };
      await writeJsonAtomic(CUSTOM_FILE, latest);
      return apiSuccess(res, 200, 'Đã lưu custom.', latest[index]);
    });
  }

  if (customMatch && req.method === 'DELETE') {
    const id = normalizeCustomId(decodeURIComponent(customMatch[1]));
    const confirmDelete = url.searchParams.get('confirm') === 'yes';
    return withWriteLock(async () => {
      const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
      const latestTeams = readJson(TEAM_FILE, []);
      if (!latestCustoms.some(item => item.id === id)) return apiError(res, 404, 'Không tìm thấy custom.');
      const count = latestTeams.filter(team => team.customId === id).length;
      if (count && !confirmDelete) return apiError(res, 409, `Custom đang có ${count} đội. Cần xác nhận xóa dữ liệu.`);
      await backupFiles(`delete-custom-${id}`);
      await writeJsonAtomic(CUSTOM_FILE, latestCustoms.filter(item => item.id !== id));
      await writeJsonAtomic(TEAM_FILE, latestTeams.filter(team => team.customId !== id));
      return apiSuccess(res, 200, 'Đã xóa custom và tạo bản sao lưu.');
    });
  }

  const customTeamsMatch = url.pathname.match(/^\/api\/admin\/customs\/([^/]+)\/teams$/);
  if (customTeamsMatch && req.method === 'GET') {
    const id = normalizeCustomId(decodeURIComponent(customTeamsMatch[1]));
    if (!customs.some(item => item.id === id)) return apiError(res, 404, 'Không tìm thấy custom.');
    return apiSuccess(res, 200, 'Đã tải danh sách team.', teams.filter(team => team.customId === id));
  }

  const teamMatch = url.pathname.match(/^\/api\/admin\/teams\/([^/]+)$/);
  if (teamMatch && req.method === 'PUT') {
    const body = await parseBody(req);
    const id = decodeURIComponent(teamMatch[1]);
    return withWriteLock(async () => {
      const latestTeams = readJson(TEAM_FILE, []);
      const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
      const index = latestTeams.findIndex(team => team.id === id);
      if (index < 0) return apiError(res, 404, 'Không tìm thấy team.');
      const current = latestTeams[index];
      const targetId = normalizeCustomId(body.customId || current.customId);
      const target = latestCustoms.find(item => item.id === targetId);
      if (!target) return apiError(res, 404, 'Custom đích không tồn tại.');
      const checked = validateTeamInput({ ...current, ...body, customId: targetId }, cfg);
      if (checked.errors.length) return apiError(res, 400, 'Thông tin team chưa hợp lệ.', checked.errors);
      const conflicts = conflictsForTeam(checked.value, latestTeams, id);
      if (conflicts.length) return apiError(res, 409, 'Dữ liệu trùng trong custom.', conflicts);
      let slot = current.teamSlot;
      if (targetId !== current.customId) {
        slot = nextSlot(targetId, latestTeams, cfg, id);
        if (!slot) return apiError(res, 409, 'Custom đích đã đầy.');
      }
      latestTeams[index] = {
        ...current,
        ...checked.value,
        teamSlot: slot,
        status: 'approved',
        playerNation: cleanText(body.playerNation ?? current.playerNation, 40),
        updatedAt: new Date().toISOString()
      };
      await writeJsonAtomic(TEAM_FILE, latestTeams);
      return apiSuccess(res, 200, 'Đã cập nhật team.', latestTeams[index]);
    });
  }

  if (teamMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(teamMatch[1]);
    return withWriteLock(async () => {
      const latest = readJson(TEAM_FILE, []);
      if (!latest.some(team => team.id === id)) return apiError(res, 404, 'Không tìm thấy team.');
      await backupFiles(`delete-team-${id}`);
      await writeJsonAtomic(TEAM_FILE, latest.filter(team => team.id !== id));
      return apiSuccess(res, 200, 'Đã xóa team và tạo bản sao lưu.');
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/import') {
    const body = await parseBody(req, 2_000_000);
    const targetId = normalizeCustomId(body.customId);
    const inputs = Array.isArray(body.teams) ? body.teams : [];
    if (!inputs.length) return apiError(res, 400, 'Chưa có team để nạp.');
    return withWriteLock(async () => {
      const latestTeams = readJson(TEAM_FILE, []);
      const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
      const custom = latestCustoms.find(item => item.id === targetId);
      if (!custom) return apiError(res, 404, 'Custom không tồn tại.');
      const staged = [];
      const errors = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const checked = validateTeamInput({ ...inputs[index], customId: targetId }, cfg);
        const conflicts = checked.errors.length ? [] : conflictsForTeam(checked.value, [...latestTeams, ...staged]);
        if (checked.errors.length || conflicts.length) {
          errors.push(`Team ${index + 1}: ${[...checked.errors, ...conflicts].join(' ')}`);
          continue;
        }
        const slot = nextSlot(targetId, [...latestTeams, ...staged], cfg);
        if (!slot) { errors.push(`Team ${index + 1}: custom đã đầy.`); continue; }
        const now = new Date().toISOString();
        staged.push({
          id: crypto.randomUUID(), editToken: crypto.randomBytes(24).toString('hex'), ...checked.value,
          teamSlot: slot, status: 'approved', createdAt: now, updatedAt: now
        });
      }
      if (errors.length) return apiError(res, 400, 'Danh sách còn lỗi, chưa lưu dữ liệu.', errors);
      await writeJsonAtomic(TEAM_FILE, [...latestTeams, ...staged]);
      return apiSuccess(res, 201, `Đã nạp ${staged.length} team.`, { count: staged.length });
    });
  }

  const exportMatch = url.pathname.match(/^\/api\/admin\/export\/([^/]+)$/);
  if (req.method === 'GET' && exportMatch) {
    await writeQueue.catch(() => {});
    const id = normalizeCustomId(decodeURIComponent(exportMatch[1]));
    const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
    const latestTeams = readJson(TEAM_FILE, []);
    const custom = latestCustoms.find(item => item.id === id);
    if (!custom) return apiError(res, 404, 'Không tìm thấy custom.');
    const prepared = prepareExport(custom, latestTeams, cfg);
    const failed = sendExportError(res, prepared);
    if (failed !== false) return failed;
    return downloadJson(res, prepared.output, custom);
  }

  const previewMatch = url.pathname.match(/^\/api\/admin\/export-preview\/([^/]+)$/);
  if (req.method === 'GET' && previewMatch) {
    await writeQueue.catch(() => {});
    const id = normalizeCustomId(decodeURIComponent(previewMatch[1]));
    const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
    const latestTeams = readJson(TEAM_FILE, []);
    const custom = latestCustoms.find(item => item.id === id);
    if (!custom) return apiError(res, 404, 'Không tìm thấy custom.');
    const prepared = prepareExport(custom, latestTeams, cfg);
    return apiSuccess(res, 200, 'Dữ liệu export đã được đồng bộ từ storage.', {
      synchronized: true,
      ready: prepared.ready,
      latestUpdatedAt: prepared.latestUpdatedAt,
      totalTeams: prepared.totalTeams,
      totalPlayers: prepared.totalPlayers,
      rawPlayerCount: prepared.rawPlayerCount,
      conflictCount: prepared.conflictCount,
      conflicts: prepared.conflicts,
      errors: prepared.validationErrors,
      players: prepared.output.PlayerNameList
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/export-all') {
    await writeQueue.catch(() => {});
    const latestCustoms = readJson(CUSTOM_FILE, initialCustoms());
    const latestTeams = readJson(TEAM_FILE, []);
    const approved = latestTeams.filter(team => team.status === 'approved');
    const activeCustomIds = [...new Set(approved.map(team => team.customId))];
    const preparedByCustom = new Map();
    for (const customId of activeCustomIds) {
      const custom = latestCustoms.find(item => item.id === customId);
      if (!custom) return apiError(res, 404, `Custom ${customId} của team đã lưu không còn tồn tại.`);
      const prepared = prepareExport(custom, latestTeams, cfg);
      preparedByCustom.set(customId, prepared);
      const failed = sendExportError(res, prepared);
      if (failed !== false) return failed;
    }
    const ownersById = new Map();
    approved.forEach(team => (team.players || []).forEach(player => {
      const playerId = String(player?.playerId ?? '').trim();
      if (!ownersById.has(playerId)) ownersById.set(playerId, new Map());
      ownersById.get(playerId).set(team.id, { teamId: team.id, teamName: team.teamName, customId: team.customId });
    }));
    const conflicts = [...ownersById.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([playerId, owners]) => ({ playerId, teams: [...owners.values()] }));
    if (conflicts.length) {
      return json(res, 409, { success: false, message: 'Không thể xuất file vì có PlayerID bị trùng giữa các custom.', conflicts });
    }
    if (activeCustomIds.length !== 1) {
      return json(res, 409, {
        success: false,
        message: activeCustomIds.length
          ? 'Không thể gộp nhiều custom vào một TeamRegionList 15 slot. Hãy chọn một custom để xuất.'
          : 'Chưa có team đã lưu để xuất. Hãy chọn một custom để kiểm tra.',
        customs: activeCustomIds
      });
    }
    const custom = latestCustoms.find(item => item.id === activeCustomIds[0]);
    if (!custom) return apiError(res, 404, 'Custom của team đã lưu không còn tồn tại.');
    const prepared = preparedByCustom.get(custom.id);
    return downloadJson(res, prepared.output, custom);
  }

  const clearMatch = url.pathname.match(/^\/api\/admin\/customs\/([^/]+)\/teams$/);
  if (clearMatch && req.method === 'DELETE') {
    const id = normalizeCustomId(decodeURIComponent(clearMatch[1]));
    return withWriteLock(async () => {
      const latest = readJson(TEAM_FILE, []);
      await backupFiles(`clear-custom-${id}`);
      await writeJsonAtomic(TEAM_FILE, latest.filter(team => team.customId !== id));
      return apiSuccess(res, 200, 'Đã xóa dữ liệu custom và tạo bản sao lưu.');
    });
  }

  return false;
}

function serveLogo(req, res, url) {
  if (!adminSession(req)) {
    return send(res, 302, '', { Location: '/admin' });
  }
  if (url.pathname === '/logo' || url.pathname === '/admin/logo') {
    return send(res, 302, '', { Location: '/logo/' });
  }
  const files = {
    '/logo/': 'index.html',
    '/logo/index.html': 'index.html',
    '/logo/style.css': 'style.css',
    '/logo/script.js': 'script.js',
    '/logo/logo-bundle.js': 'logo-bundle.js',
    '/logo/avatars_b64.js': 'avatars_b64.js'
  };
  const file = files[url.pathname];
  if (!file) return send(res, 404, 'Kh?ng t?m th?y trang.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, '', { Allow: 'GET, HEAD' });
  }
  const body = fs.readFileSync(path.join(ROOT, 'private', 'logo', file));
  return send(res, 200, req.method === 'HEAD' ? undefined : body, {
    'Content-Type': MIME[path.extname(file)],
    Vary: 'Cookie'
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const cfg = config();
  try {
    if (url.pathname === '/admin/logo' || url.pathname === '/logo' || url.pathname.startsWith('/logo/')) {
      return serveLogo(req, res, url);
    }
    if (url.pathname.startsWith('/api/admin/')) {
      const handled = await handleAdminApi(req, res, url, cfg);
      if (handled !== false) return handled;
      return apiError(res, 404, 'API quản trị không tồn tại.');
    }
    if (url.pathname.startsWith('/api/')) {
      const handled = await handlePublicApi(req, res, url, cfg);
      if (handled !== false) return handled;
      return apiError(res, 404, 'API không tồn tại.');
    }
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return apiError(res, error.status || 500, error.status ? error.message : 'Máy chủ gặp lỗi. Vui lòng thử lại.');
  }
});

// Scheduler tự động reset toàn bộ submissions lúc 4:00 sáng mỗi ngày
function scheduleDailyReset() {
  const now = new Date();
  const next4am = nextVietnamReset(now);
  const msUntil = next4am - now;
  console.log(`[Reset] Lần reset tiếp theo lúc ${next4am.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (VN)'} (sau ${Math.round(msUntil / 60000)} phút)`);
  setTimeout(async () => {
    try {
      await withWriteLock(async () => {
        await backupFiles('auto-reset-4am');
        await writeJsonAtomic(TEAM_FILE, []);
        console.log(`[Reset] Đã xóa toàn bộ submissions lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
      });
    } catch (error) {
      console.error('[Reset] Lỗi khi reset submissions:', error.message);
    }
    scheduleDailyReset(); // lên lịch cho ngày hôm sau
  }, msUntil);
}

ensureStorage().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Web đang chạy tại http://localhost:${PORT}`);
    console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
    if (ADMIN_KEY === 'change-me') console.warn('CẢNH BÁO: hãy đặt biến môi trường ADMIN_KEY trước khi đưa web lên mạng.');
    scheduleDailyReset();
  });
}).catch(error => {
  console.error('Không khởi tạo được kho dữ liệu:', error);
  process.exitCode = 1;
});

module.exports = { server, normalizeCustomId, validatePlayers, buildExport };
