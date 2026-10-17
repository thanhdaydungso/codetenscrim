'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {inflateSync} = require('node:zlib');
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function pngCrc(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const fail = (status, message) => Object.assign(new Error(message), {status});
function validateImage(image) {
  if (typeof image !== 'string' || image.length > 14_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw fail(400, 'Chọn ảnh PNG hợp lệ, tối đa 10 MB.');
  const bytes = Buffer.from(image.slice(22), 'base64');
  if (bytes.length < 33 || bytes.length > 10_485_760 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii',12,16) !== 'IHDR') throw fail(400, 'Ảnh PNG không hợp lệ.');
  const w=bytes.readUInt32BE(16), h=bytes.readUInt32BE(20);
  if (!w || !h || w>4096 || h>4096 || w*h>4_000_000) throw fail(400, 'Ảnh quá lớn. Hãy chọn ảnh dưới 4 triệu pixel.');
  // Browser uploads are normalized to a non-interlaced 8-bit PNG.
  const channels={0:1,2:3,3:1,4:2,6:4}[bytes[25]];
  if(bytes.readUInt32BE(8)!==13 || bytes[24]!==8 || !channels || bytes[26]!==0 || bytes[27]!==0 || bytes[28]!==0)throw fail(400,'Định dạng PNG không được hỗ trợ. Hãy gửi lại qua trang nhận logo.');
  const parts=[];let offset=8,ended=false;
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if(end>bytes.length || pngCrc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw fail(400,'Ảnh PNG bị hỏng.');
    const type=bytes.toString('ascii',offset+4,offset+8);
    if(type==='IDAT')parts.push(bytes.subarray(offset+8,end-4));
    offset=end;
    if(type==='IEND'){ended=true;if(length!==0 || offset!==bytes.length)throw fail(400,'Ảnh PNG bị hỏng.');break;}
  }
  if(!ended || !parts.length)throw fail(400,'Ảnh PNG thiếu dữ liệu.');
  const rowLength=w*channels+1,expected=rowLength*h;
  try{
    const pixels=inflateSync(Buffer.concat(parts),{maxOutputLength:expected});
    if(pixels.length!==expected)throw Error('size');
    for(let row=0;row<h;row++)if(pixels[row*rowLength]>4)throw Error('filter');
  }catch{throw fail(400,'Không đọc được dữ liệu ảnh PNG.');}
  return image;
}
function validateLogo(value) {
  if (!value || typeof value !== 'object') throw fail(400,'Thiếu ảnh logo.');
  const logo = {name:String(value.name || 'Logo').slice(0,100),image:validateImage(value.image)};
  if (value.cutout) logo.cutout=validateImage(value.cutout);
  if (value.background) logo.background=validateImage(value.background);
  if (value.bgColor && /^#[a-f0-9]{6}$/i.test(value.bgColor)) logo.bgColor=value.bgColor;
  if (value.keyColor && /^#[a-f0-9]{6}$/i.test(value.keyColor)) logo.keyColor=value.keyColor;
  if (value.scale != null) { if (!Number.isFinite(value.scale) || value.scale<0.1 || value.scale>3) throw fail(400,'Tỉ lệ logo không hợp lệ.'); logo.scale=value.scale; }
  return logo;
}
function validateBoard(value) {
  if (!value || !Array.isArray(value.teams) || !value.teams.length || value.teams.length>200 || !Array.isArray(value.logos) || value.logos.length>400 || !Array.isArray(value.assignments) || value.assignments.length!==value.teams.length) throw fail(400,'Bảng cần 1–200 đội và tối đa 400 logo.');
  const data={version:1,teams:value.teams.map(team=>({name:String(team.name || '').trim().slice(0,100),person:String(team.person || '').slice(0,100),code:String(team.code || '').slice(0,40)})),logos:value.logos.map(validateLogo),assignments:[...value.assignments],customId:String(value.customId || '').slice(0,100)};
  if(data.teams.some(team=>!team.name))throw fail(400,'Tên đội không được để trống.');
  if(data.assignments.some(i=>!Number.isInteger(i)||i < -1||i>=data.logos.length))throw fail(400,'Gán logo không hợp lệ.');
  if(value.defaultLogo)data.defaultLogo=validateLogo(value.defaultLogo);
  const border=value.borderColor;
  if(!border || !Number.isInteger(border.style) || border.style<0 || border.style>30 || !Number.isFinite(border.seed) || !Array.isArray(border.colors) || !border.colors.length || border.colors.length>20 || border.colors.some(color=>!/^#[a-f0-9]{6}$/i.test(color)))throw fail(400,'Màu viền không hợp lệ.');
  if(!Number.isFinite(border.angle)||!Number.isFinite(border.shine)||border.shine<0.12||border.shine>0.85)throw fail(400,'Ánh sáng viền không hợp lệ.');
  data.borderColor={style:border.style,seed:border.seed,angle:border.angle,shine:border.shine,colors:[...border.colors]};
  if(Buffer.byteLength(JSON.stringify(data))>100_000_000)throw fail(413,'Bảng backup quá lớn (tối đa 100 MB).');
  return data;
}
class LogoBoardStore {
  constructor({storage, dataDir, now=Date.now}) {this.storage=storage;this.file=path.join(dataDir,'logo-boards.json');this.queue=Promise.resolve();this.now=now;}
  async call(action, {id=null,token=null,payload=null}={}) {
    if(this.storage)return this.storage.rpc('scrim_logo_board',{operation:action,board_id:id,share_token:token,payload});
    const execute=async()=>{
      let boards;
      try{boards=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;boards=[];}
      const now=this.now();
      const flush=async()=>{
        await fs.mkdir(path.dirname(this.file),{recursive:true});
        const temp=this.file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(boards));await fs.rename(temp,this.file);
      };
      const previousLength=boards.length;
      boards=boards.map(item=>({...item,accepting:item.data.assignments.includes(-1),expires_at:item.expires_at||new Date(Date.parse(item.updated_at)+7_200_000).toISOString()})).filter(item=>Date.parse(item.expires_at)>now);
      const deleted=previousLength-boards.length;
      if(deleted)await flush();
      if(action==='cleanup')return {deleted};
      let board=boards.find(item=>token ? item.token===token : item.id===id);
      const info=item=>({id:item.id,name:item.name,token:item.token,accepting:item.accepting,updated_at:item.updated_at,expires_at:item.expires_at,teamCount:item.data.teams.length,missing:item.data.assignments.filter(i=>i===-1).length});
      if(action==='list')return boards.map(info).reverse();
      if(action==='create') {board={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),name:payload.name,data:payload.data,accepting:payload.data.assignments.includes(-1),created_at:new Date(now).toISOString(),expires_at:new Date(now+7_200_000).toISOString(),updated_at:new Date(now).toISOString()};boards.push(board);}
      else {
        if(!board)throw fail(404,'Bảng logo không tồn tại hoặc đã hết hạn 2 giờ.');
        if(action==='read')return board;
        if(action==='public')return {name:board.name,accepting:board.accepting,expires_at:board.expires_at,teams:board.data.teams.map((team,index)=>({name:team.name,index,assigned:board.data.assignments[index]!==-1}))};
        if(action==='close')throw fail(405,'Link tự mở khi thiếu logo và tự khóa khi đủ logo.');
        else if(action==='submit'){
          if(!board.accepting)throw fail(409,'Link đã đóng nhận logo.');
          const slot=payload.slot;
          if(!Number.isInteger(slot)||slot<0||slot>=board.data.teams.length)throw fail(400,'Đội không hợp lệ.');
          if(board.data.assignments[slot]!==-1)throw fail(409,'Đội này đã có logo. Hãy tải lại bảng.');
          if(Buffer.byteLength(JSON.stringify(board.data))+Buffer.byteLength(JSON.stringify(payload.logo))>100_000_000)throw fail(413,'Bảng đã đầy. Hãy liên hệ BTC.');
          board.data.assignments[slot]=board.data.logos.length;board.data.logos.push(payload.logo);
          board.accepting=board.data.assignments.includes(-1);
        } else throw fail(400,'Thao tác không hợp lệ.');
      }
      board.updated_at=new Date(now).toISOString();
      await flush();
      return action==='submit'?{saved:true}:board;
    };
    const result=this.queue.then(execute,execute);this.queue=result.catch(()=>{});return result;
  }
}
module.exports={LogoBoardStore,validateBoard,validateLogo};
