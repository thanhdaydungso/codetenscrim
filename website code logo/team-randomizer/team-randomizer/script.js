'use strict';
const $ = id => document.getElementById(id);
let teams = [], logos = [], busy = false, uploading = false;
let manualAssignments = [];
const SIZE = 1000;
const AVATAR_ORDER = [
  {name:'Andrew', id:902000006, file:'Andrew'},
  {name:'Kelly', id:902000007, file:'Kelly'},
  {name:'Olivia', id:902000008, file:'Olivia'},
  {name:'Ford', id:902000009, file:'Ford'},
  {name:'Nikita', id:902000010, file:'Nikita'},
  {name:'Misha', id:902000012, file:'Misha'},
  {name:'Maxim', id:902000030, file:'Maxim'},
  {name:'Kla', id:902000062, file:'Kla'},
  {name:'Paloma', id:902000080, file:'Paloma'},
  {name:'Miguel', id:902000081, file:'Miguel'},
  {name:'Caroline', id:902000096, file:'Caroline'},
  {name:'Antonio', id:902000102, file:'Antonio'},
  {name:'Ngộ Không', id:902000110, file:'NgoKhong'},
  {name:'Moco', id:902000119, file:'Moco'},
  {name:'Hayato', id:902000130, file:'Hayato'}
];
function avatarFor(index) { return AVATAR_ORDER[index % AVATAR_ORDER.length]; }
function exportName(index) {
  const filename = avatarFor(index).id + '.png';
  return teams.length > AVATAR_ORDER.length ? 'bang_' + (Math.floor(index / AVATAR_ORDER.length) + 1) + '/' + filename : filename;
}
const normalize = name => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
function parseRoster(text) {
  return text.split(/\r?\n/).map(line => {
    const parts = line.trim().split('|').map(p => p.trim());
    const name = parts[0].replace(/^\d+\s*[.)\-:]?\s+/, '').trim();
    return { name, person: parts[1] || '', code: parts[2] || '' };
  }).filter(team => team.name);
}
let defaultFlagLogo;
function flagLogo() {
  if (defaultFlagLogo) return defaultFlagLogo;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#DA251D';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? 95 : 250;
    const x = SIZE / 2 + Math.cos(angle) * radius;
    const y = SIZE / 2 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#FFFF00';
  ctx.fill();
  defaultFlagLogo = {img: canvas, isFallback: true};
  return defaultFlagLogo;
}
function pairs() {
  return teams.map((team, index) => ({team, index, avatar:avatarFor(index), logo:manualAssignments[index] || flagLogo()}));
}

function assignManual(teamIndex, logoIndex) {
  if (busy || uploading || !teams[teamIndex]) return;
  if (logoIndex !== -1 && !logos[logoIndex]) return;
  const logo = logoIndex === -1 ? null : logos[logoIndex];
  if (logo) manualAssignments = manualAssignments.map(item => item === logo ? null : item);
  manualAssignments[teamIndex] = logo;
  render();
  tell(teams[teamIndex].name + ': ' + (logo ? 'Logo ' + (logos.indexOf(logo) + 1) : 'Cờ Việt Nam mặc định'));
}
function enableLogoDrop(cell, teamIndex) {
  cell.classList.add('logo-target');
  cell.addEventListener('dragover', event => {
    if (busy || uploading || !Array.from(event.dataTransfer.types).includes('application/x-team-logo')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; cell.classList.add('drag-over');
  });
  cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
  cell.addEventListener('drop', event => {
    event.preventDefault(); event.stopPropagation(); cell.classList.remove('drag-over');
    const raw = event.dataTransfer.getData('application/x-team-logo');
    if (!/^\d+$/.test(raw)) return;
    assignManual(teamIndex, Number(raw));
  });
}
function renderManualStudio() {
  $('manualStudio').hidden = false;
  $('logoTray').replaceChildren();
  const assigned = new Set(manualAssignments.filter(Boolean));
  logos.forEach((logo, index) => {
    if (assigned.has(logo)) return;
    const card = document.createElement('div'); card.className = 'logo-card'; card.draggable = !busy && !uploading;
    const image = document.createElement('img'); image.src = logo.avatarPreview || logo.url; image.alt = 'Logo ' + (index + 1);
    const name = document.createElement('span'); name.textContent = 'Logo ' + (index + 1);
    card.append(image, name);
    card.addEventListener('dragstart', event => {
      if (busy || uploading) { event.preventDefault(); return; }
      event.dataTransfer.setData('application/x-team-logo', String(index)); event.dataTransfer.effectAllowed = 'move';
    });
    $('logoTray').append(card);
  });
}

function tell(message) { $('status').textContent = message; }
function render() {
  const matched = pairs();
  const assignedLogos = new Set(manualAssignments.filter(Boolean));
  $('roster').replaceChildren();
  matched.forEach(({team, logo, avatar, index}, i) => {
    const row = document.createElement('tr');
    const num = document.createElement('td'); num.textContent = i + 1;
    const info = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = team.name; info.append(name);
    const logoCell = document.createElement('td');
    if (!logo.avatarPreview) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      draw(canvas, logo);
      logo.avatarPreview = canvas.toDataURL('image/png');
    }
    const logoImage = document.createElement('img');
    logoImage.src = logo.avatarPreview;
    logoImage.alt = team.name;
    logoImage.className = 'character-avatar assigned-logo';
    logoCell.append(logoImage);
    const avatarCell = document.createElement('td');
    const avatarImage = document.createElement('img');
    avatarImage.src = 'avatars/' + avatar.file + '.png';
    avatarImage.alt = avatar.name;
    avatarImage.className = 'character-avatar';
    avatarCell.append(avatarImage);
    {
      enableLogoDrop(logoCell, index); enableLogoDrop(avatarCell, index);
      const select = document.createElement('select');
      select.className = 'manual-logo-select'; select.setAttribute('aria-label', 'Logo: ' + team.name);
      const fallback = document.createElement('option'); fallback.value = '-1'; fallback.textContent = 'Cờ Việt Nam'; select.append(fallback);
      logos.forEach((item, logoIndex) => {
        if (assignedLogos.has(item) && item !== logo) return;
        const option = document.createElement('option'); option.value = String(logoIndex); option.textContent = 'Logo ' + (logoIndex + 1); select.append(option);
      });
      select.value = String(logos.indexOf(logo)); select.disabled = busy || uploading;
      select.onchange = () => assignManual(index, Number(select.value));
      const controls = document.createElement('div'); controls.className = 'logo-controls';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Gỡ';
      remove.className = 'remove-logo'; remove.setAttribute('aria-label', 'Gỡ logo: ' + team.name);
      remove.disabled = logo.isFallback || busy || uploading;
      remove.onclick = () => assignManual(index, -1);
      controls.append(select, remove); logoCell.append(controls);
    }
    const character = document.createElement('td');
    const characterName = document.createElement('strong'); characterName.textContent = avatar.name;
    character.append(characterName);
    row.append(num, info, logoCell, avatarCell, character); $('roster').append(row);
  });
  $('empty').hidden = teams.length > 0;
  const count = matched.filter(p => !p.logo.isFallback).length;
  $('stats').textContent = `${teams.length} team · ${logos.length} logo · ${count} đã ghép`;
  $('download').disabled = !teams.length || busy || uploading;
  $('copyTable').disabled = !teams.length || busy || uploading;
  ['replace','append','reset','files'].forEach(id => $(id).disabled = busy || (id === 'files' && uploading));

  const warnings = [];
  if (count < teams.length) warnings.push(`${teams.length - count} team ${'sử dụng cờ Việt Nam mặc định'}.`);
  if (logos.length) {

    const used = new Set(matched.map(p => p.logo).filter(logo => !logo.isFallback));
    if (used.size < logos.length) warnings.push(`${logos.length - used.size} logo không được sử dụng.`);
  }
  $('matchWarning').textContent = warnings.join(' ');
  const selected = $('previewSelect').value;
  $('previewSelect').replaceChildren();
  logos.forEach((logo, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = 'Logo ' + (i + 1); $('previewSelect').append(option); });
  if (!logos.length) { const option = document.createElement('option'); option.textContent = 'Chưa có logo'; option.value = ''; $('previewSelect').append(option); }
  else $('previewSelect').value = selected !== '' && logos[Number(selected)] ? selected : '0';
  preview();
  renderManualStudio();
}
function drawImageFit(ctx, img, x, y, width, height, cover) {
  const imageWidth = img.naturalWidth || img.width;
  const imageHeight = img.naturalHeight || img.height;
  const scale = (cover ? Math.max : Math.min)(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  ctx.drawImage(img, x + (width - w) / 2, y + (height - h) / 2, w, h);
}
function draw(canvas, logo) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (!logo) return;
  const center = SIZE / 2;
  const borderWidth = 50;
  const radius = (SIZE - borderWidth) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.clip();
  drawImageFit(ctx, logo.img, borderWidth / 2, borderWidth / 2,
    SIZE - borderWidth, SIZE - borderWidth, true);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  const gold = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  gold.addColorStop(0, '#C58A12');
  gold.addColorStop(0.22, '#E5B936');
  gold.addColorStop(0.48, '#FFF58A');
  gold.addColorStop(0.58, '#F6E66B');
  gold.addColorStop(0.8, '#DDB12C');
  gold.addColorStop(1, '#B77B0C');
  ctx.strokeStyle = gold;
  ctx.lineWidth = borderWidth;
  ctx.stroke();
  // Fine outlines remain within the 50px ring.
  ctx.beginPath();
  ctx.arc(center, center, center - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#9B722B';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center, center, center - borderWidth + 1, 0, Math.PI * 2);
  ctx.strokeStyle = '#695020';
  ctx.lineWidth = 2;
  ctx.stroke();
}
function preview() { const logo = logos[Number($('previewSelect').value)] || (teams.length ? flagLogo() : null); draw($('preview'),logo); $('previewName').textContent = logo ? (logo.isFallback ? 'Cờ Việt Nam mặc định' : 'Logo ' + (logos.indexOf(logo) + 1)) : 'Chưa có logo'; }
async function upload(files) {
  if (busy || uploading) return;
  uploading = true; render(); let failed = 0, added = 0;
  for (const file of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || (file.type && !/^image\/(png|jpeg|webp)$/.test(file.type))) { failed++; continue; }
    const url = URL.createObjectURL(file), img = new Image();
    try { img.src = url; await img.decode(); logos.push({file,url,img,name:file.name.replace(/\.[^.]+$/,'')}); added++; }
    catch { URL.revokeObjectURL(url); failed++; }
  }
  uploading = false; $('files').value = ''; render(); tell(`Đã thêm ${added} logo.${failed ? ` Bỏ qua ${failed} file không hợp lệ hoặc không đọc được.` : ''}`);
}
// ZIP store: PNG is already compressed. UTF-8 filenames and CRC32 require no external library.
const crcTable = Uint32Array.from({length:256}, (_,n) => { let c=n; for(let k=0;k<8;k++)c=c&1 ? 0xedb88320^(c>>>1) : c>>>1; return c>>>0; });
function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }
function zipHeader(length) { const bytes=new Uint8Array(length); return {bytes,view:new DataView(bytes.buffer)}; }
function makeZip(entries) {
  const local=[],central=[]; let offset=0,centralSize=0;
  for(const entry of entries) {
    const name=new TextEncoder().encode(entry.name), data=entry.data, crc=crc32(data);
    const a=zipHeader(30); a.view.setUint32(0,0x04034b50,true); a.view.setUint16(4,20,true);a.view.setUint16(6,0x800,true);a.view.setUint16(12,33,true);a.view.setUint32(14,crc,true);a.view.setUint32(18,data.length,true);a.view.setUint32(22,data.length,true);a.view.setUint16(26,name.length,true);
    const b=zipHeader(46);b.view.setUint32(0,0x02014b50,true);b.view.setUint16(4,20,true);b.view.setUint16(6,20,true);b.view.setUint16(8,0x800,true);b.view.setUint16(14,33,true);b.view.setUint32(16,crc,true);b.view.setUint32(20,data.length,true);b.view.setUint32(24,data.length,true);b.view.setUint16(28,name.length,true);b.view.setUint32(42,offset,true);
    local.push(a.bytes,name,data);central.push(b.bytes,name);offset+=30+name.length+data.length;centralSize+=46+name.length;
    if(offset+centralSize>0xffffffff)throw new Error('ZIP quá lớn. Hãy xuất từng nhóm nhỏ hơn.');
  }
  const end=zipHeader(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}
async function download() {
  const matched=pairs(); if(!matched.length || busy || uploading)return;
  if(matched.length>65535){tell('Tối đa 65535 ảnh mỗi ZIP. Hãy chia danh sách thành nhóm nhỏ hơn.');return;}
  busy=true;render();const entries=[],canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
  try {
    for(let i=0;i<matched.length;i++) {
      const {logo,index}=matched[i];tell(`Đang tạo ảnh ${i+1}/${matched.length}…`);draw(canvas,logo);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Không tạo được ảnh PNG.');
      const name = exportName(index);
      entries.push({name,data:new Uint8Array(await blob.arrayBuffer())});
    }
    const url=URL.createObjectURL(makeZip(entries)),link=document.createElement('a');link.href=url;link.download='team-logos-1000x1000.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    tell(`Đã tạo ZIP gồm ${entries.length} ảnh PNG 1000×1000.`);
  }catch(error){tell(`Xuất thất bại: ${error.message}`);}finally{busy=false;render();}
}

function tableTextLines(ctx, text, maxWidth) {
  const lines = []; let line = '';
  for (const char of String(text)) {
    if (line && ctx.measureText(line + char).width > maxWidth) {
      lines.push(line); line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}
async function tableImageBlob() {
  const rows = pairs();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const widths = [70, 450, 150, 150, 380];
  const edges = [0]; widths.forEach(width => edges.push(edges[edges.length - 1] + width));
  const headerHeight = 80;
  ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  const layout = rows.map(row => {
    const lines = tableTextLines(ctx, row.team.name, widths[1] - 32);
    return {row, lines, height: Math.max(110, lines.length * 34 + 28)};
  });
  canvas.width = edges[5];
  canvas.height = headerHeight + layout.reduce((height, item) => height + item.height, 0);
  if (canvas.height > 32760) throw new Error('Bảng quá dài. Hãy chia danh sách thành các nhóm nhỏ hơn.');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#F0F3F8'; ctx.fillRect(0, 0, canvas.width, headerHeight);
  ctx.fillStyle = '#141820'; ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const headers = ['NO.', 'TÊN TEAM', 'LOGO', 'AVATAR', 'TÊN NHÂN VẬT'];
  headers.forEach((text, i) => ctx.fillText(text, edges[i] + widths[i] / 2, headerHeight / 2));
  const characterImages = new Map();
  await Promise.all([...new Set(rows.map(row => row.avatar.file))].map(async file => {
    const image = new Image();
    image.src = typeof AVATAR_B64 !== 'undefined' && AVATAR_B64[file]
      ? 'data:image/png;base64,' + AVATAR_B64[file] : 'avatars/' + file + '.png';
    await image.decode(); characterImages.set(file, image);
  }));
  const boundaries = [0, headerHeight]; let y = headerHeight;
  const logoCanvas = document.createElement('canvas'); logoCanvas.width = logoCanvas.height = SIZE;
  layout.forEach(({row, lines, height}, index) => {
    ctx.fillStyle = '#141820'; ctx.font = '26px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText(String(index + 1), widths[0] / 2, y + height / 2);
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left';
    lines.forEach((text, line) => ctx.fillText(text, edges[1] + 16, y + height / 2 + (line - (lines.length - 1) / 2) * 34));
    draw(logoCanvas, row.logo);
    ctx.drawImage(logoCanvas, edges[2] + (widths[2] - 84) / 2, y + (height - 84) / 2, 84, 84);
    ctx.drawImage(characterImages.get(row.avatar.file), edges[3] + (widths[3] - 84) / 2, y + (height - 84) / 2, 84, 84);
    ctx.textAlign = 'center'; ctx.fillText(row.avatar.name, edges[4] + widths[4] / 2, y + height / 2);
    y += height; boundaries.push(y);
  });
  ctx.strokeStyle = '#687080'; ctx.lineWidth = 1; ctx.beginPath();
  edges.forEach(x => { const px = Math.min(Math.max(x, 0.5), canvas.width - 0.5); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); });
  boundaries.forEach(y => { const py = Math.min(Math.max(y, 0.5), canvas.height - 0.5); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); });
  ctx.stroke();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG failed')), 'image/png'));
}
async function copyTableImage() {
  if (!teams.length || busy || uploading) return;
  busy = true; render(); tell('Đang tạo ảnh bảng…');
  try {
    const blobPromise = tableImageBlob();
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([new ClipboardItem({'image/png': blobPromise})]);
        tell('Đã copy ảnh bảng. Dùng Ctrl + V để dán.');
        return;
      } catch (error) {
        // If clipboard access is denied, keep the generated image available as a download.
      }
    }
    const blob = await blobPromise;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'bang-team.png'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    tell('Trình duyệt không cho phép copy ảnh. Đã tải bang-team.png.');
  } catch (error) { tell('Không tạo được ảnh bảng: ' + error.message); }
  finally { busy = false; render(); }
}

$('replace').onclick=()=>{if(busy)return;const parsed=parseRoster($('teamInput').value);if(!parsed.length){tell('Hãy nhập ít nhất một team.');return;}teams=parsed;manualAssignments=[];render();tell(`Đã nhập ${teams.length} team.`);};
$('append').onclick=()=>{if(busy)return;const parsed=parseRoster($('teamInput').value);teams.push(...parsed);render();tell(`Đã thêm ${parsed.length} team.`);};
$('reset').onclick=()=>{if(busy||uploading)return;logos.forEach(l=>URL.revokeObjectURL(l.url));teams=[];logos=[];manualAssignments=[];$('teamInput').value='';render();tell('Đã xóa bảng và logo.');};
$('files').onchange=e=>upload(Array.from(e.target.files));
['dragenter','dragover'].forEach(event=>$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.add('over');}));
['dragleave','drop'].forEach(event=>$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.remove('over');if(event==='drop')upload(Array.from(e.dataTransfer.files));}));
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('previewSelect').onchange=preview;
$('download').onclick=download;$('copyTable').onclick=copyTableImage;render();


