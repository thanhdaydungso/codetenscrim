'use strict';
(() => {
  let savedBoards=[],working=false,pendingCustom=null;
  const status=message=>{$('backupStatus').textContent=message;};
  const current=()=>savedBoards.find(board=>board.id===$('backupBoard').value && (!board.expires_at || Date.parse(board.expires_at)>Date.now()));
  async function api(path,options={}) {
    const response=await fetch('/api/admin/logo-boards'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
    const result=await response.json();if(!response.ok)throw Error(result.message||'Không truy cập được backup.');return result.data;
  }
  function update() {
    const board=current();const locked=working||busy||uploading;
    $('saveBoard').disabled=locked||!teams.length;
    ['reloadBoards','backupBoard','backupName'].forEach(id=>$(id).disabled=locked);
    ['restoreBoard','copyBoardLink','toggleBoardLink'].forEach(id=>$(id).disabled=locked||!board);
    $('backupLink').value=board?location.origin+'/logo-submit.html#'+board.token:'';
    $('toggleBoardLink').textContent=board?.accepting?'Đóng nhận logo':'Mở nhận logo';
  }
  async function refresh(id=$('backupBoard').value) {
    savedBoards=await api('');$('backupBoard').replaceChildren(new Option('Chọn bản lưu',''));
    savedBoards.forEach(board=>$('backupBoard').add(new Option(board.name+(board.expires_at?' · hết hạn '+new Date(board.expires_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}):'')+' · '+board.missing+'/'+board.teamCount+' đội trống'+(board.accepting?'':' · đã đóng'),board.id)));
    $('backupBoard').value=savedBoards.some(board=>board.id===id)?id:(savedBoards[0]?.id||'');update();
  }
  function applyCustom(){
    if(pendingCustom===null)return;
    const select=$('playnameCustom');
    if(pendingCustom && !Array.from(select.options).some(option=>option.value===pendingCustom))return;
    select.value=pendingCustom;pendingCustom=null;select.dispatchEvent(new Event('change'));
  }
  document.addEventListener('logo-customs-loaded',applyCustom);
  function imageData(img) {
    const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
    const scale=Math.min(1,1600/Math.max(w,h));const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const value=canvas.toDataURL('image/png');if(value.length>14_000_000)throw Error('Có ảnh quá lớn để backup. Hãy dùng ảnh nhỏ hơn 10 MB.');return value;
  }
  function pack(logo) {
    const value={name:logo.name||'Logo',image:imageData(logo.img)};
    if(logo.cutout)value.cutout=imageData(logo.cutout);
    if(logo.background)value.background=imageData(logo.background.img);
    ['bgColor','keyColor','scale'].forEach(key=>{if(logo[key]!=null)value[key]=logo[key];});return value;
  }
  async function unpack(value) {
    const decode=async data=>{const img=new Image();img.src=data;await img.decode();return img;};
    const logo={name:value.name,img:await decode(value.image),url:value.image};
    if(value.cutout)logo.cutout=await decode(value.cutout);
    if(value.background)logo.background={img:await decode(value.background),url:value.background};
    ['bgColor','keyColor','scale'].forEach(key=>{if(value[key]!=null)logo[key]=value[key];});return logo;
  }
  async function work(action) {
    if(working||busy||uploading)return;
    working=true;busy=true;render();update();
    try{await action();}catch(error){status(error.message);}finally{working=false;busy=false;render();update();}
  }
  $('saveBoard').onclick=()=>work(async()=>{
    status('Đang lưu ảnh và bảng…');
    const data={version:1,teams,logos:logos.map(pack),assignments:teams.map((_,i)=>manualAssignments[i]?logos.indexOf(manualAssignments[i]):-1),borderColor,customId:$('playnameCustom').value,defaultLogo:customDefaultLogo?pack(customDefaultLogo):null};
    const name=$('backupName').value.trim()||'Bảng logo '+new Date().toLocaleString('vi-VN');
    const board=await api('',{method:'POST',body:JSON.stringify({name,data})});await refresh(board.id);
    status('Đã lưu backup trong 2 giờ. Hết hạn sẽ tự xóa cả bản lưu và link.');
  });
  $('restoreBoard').onclick=()=>{
    const board=current();if(!board||working||busy||uploading)return;
    if(teams.length&&!confirm('Mở bản backup sẽ thay bảng đang chỉnh sửa. Hãy lưu backup mới nếu muốn giữ các thay đổi hiện tại. Tiếp tục?'))return;
    work(async()=>{
      status('Đang mở bản lưu và nhận logo mới…');const saved=await api('/'+board.id);const data=saved.data;
      const restored=await Promise.all(data.logos.map(unpack));const defaultLogo=data.defaultLogo?await unpack(data.defaultLogo):null;
      if(!BORDER_STYLES[data.borderColor.style])throw Error('Kiểu viền trong backup không được hỗ trợ.');
      logos.forEach(logo=>{URL.revokeObjectURL(logo.url);if(logo.background)URL.revokeObjectURL(logo.background.url);});clearDefaultLogo();
      teams=data.teams;logos=restored;manualAssignments=data.assignments.map(i=>i===-1?null:restored[i]);customDefaultLogo=defaultLogo;
      borderColor=data.borderColor;defaultFlagLogo=null;syncBorderPicker();
      $('teamInput').value=teams.map(team=>[team.name,team.person,team.code].join(' | ')).join('\n');
      $('backupName').value=saved.name;pendingCustom=data.customId||'';applyCustom();
      await refresh(board.id);status('Đã mở backup: '+manualAssignments.filter(Boolean).length+'/'+teams.length+' đội có logo.');
    });
  };
  $('reloadBoards').onclick=()=>work(async()=>{await refresh();status('Đã tải danh sách. Mở bản lưu để nhận các logo mới.');});
  $('backupBoard').onchange=update;
  $('toggleBoardLink').onclick=()=>work(async()=>{const board=current();await api('/'+board.id,{method:'PATCH',body:JSON.stringify({accepting:!board.accepting})});await refresh(board.id);status(current().accepting?'Đã mở nhận logo.':'Đã đóng link nhận logo.');});
  $('copyBoardLink').onclick=async()=>{
    const value=$('backupLink').value;if(!value)return;
    try{await navigator.clipboard.writeText(value);status('Đã sao chép link.');}catch{$('backupLink').focus();$('backupLink').select();status('Hãy sao chép link trong ô phía trên.');}
  };
  document.addEventListener('logo-board-change',update);
  setInterval(update,30_000);
  update();refresh().catch(error=>status(error.message));
})();
