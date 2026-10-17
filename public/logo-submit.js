'use strict';
(() => {
  const $=id=>document.getElementById(id);const token=location.hash.slice(1);let board=null,working=false,sent=false;
  const sentKey='logo-sent:'+token;
  try{sent=localStorage.getItem(sentKey)==='1';}catch{}
  const message=text=>{$('shareStatus').textContent=text;};
  async function api(options={}){
    if(!/^[a-f0-9]{64}$/.test(token))throw Error('Link nhận logo không hợp lệ. Hãy xin link mới từ BTC.');
    const response=await fetch('/api/logo-share/'+token,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});
    const result=await response.json();if(!response.ok)throw Error(result.message||'Không gửi được logo.');return result.data;
  }
  async function load(){
    board=await api();$('boardTitle').textContent=board.name;$('shareTeams').replaceChildren();$('teamSlot').replaceChildren(new Option('Chọn đội của bạn',''));
    board.teams.forEach(team=>{
      const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('small');
      name.textContent=(team.index+1)+'. '+team.name;state.textContent=team.assigned?'Đã có logo':'Chưa có logo';li.append(name,state);$('shareTeams').append(li);
      if(!team.assigned)$('teamSlot').add(new Option(team.name,String(team.index)));
    });
    const missing=board.teams.filter(team=>!team.assigned).length;
    sent=sent||board.submitted;
    $('logoForm').hidden=sent||!board.accepting||!missing;
    $('shareExpiry').textContent=board.expires_at?'Bản lưu và link tự xóa lúc '+new Date(board.expires_at).toLocaleString('vi-VN')+'.':'';
    message(sent?'Bạn đã gửi logo thành công. Mỗi người chỉ được gửi một lần cho bản lưu này.':!missing?'Đã đủ logo. Link nhận logo đã tự khóa.':missing+' đội đang chờ logo.');
  }
  async function png(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10_000_000)throw Error('Chọn ảnh PNG, JPG hoặc WebP dưới 10 MB.');
    const url=URL.createObjectURL(file);try{
      const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const image=canvas.toDataURL('image/png');if(image.length>14_000_000)throw Error('Ảnh sau xử lý quá lớn. Hãy chọn logo đơn giản hơn hoặc nhỏ hơn.');return image;
    }finally{URL.revokeObjectURL(url);}
  }
  $('logoFile').onchange=async()=>{const file=$('logoFile').files[0];$('logoPreview').hidden=true;if(!file)return;try{$('logoPreview').src=await png(file);$('logoPreview').hidden=false;}catch(error){message(error.message);$('logoFile').value='';}};
  $('logoForm').onsubmit=async event=>{
    event.preventDefault();if(working||sent)return;const file=$('logoFile').files[0],slot=$('teamSlot').value;if(!file||slot==='')return;
    working=true;$('sendLogo').disabled=true;$('refreshShare').disabled=true;
    try{message('Đang gửi logo…');const image=await png(file);await api({method:'POST',body:JSON.stringify({slot:Number(slot),image})});sent=true;try{localStorage.setItem(sentKey,'1');}catch{}$('logoForm').hidden=true;$('logoFile').value='';$('logoPreview').hidden=true;await load();message('Đã gửi logo thành công. Bạn không thể gửi thêm cho bản lưu này.');}
    catch(error){try{await load();}catch{}message(error.message);}
    finally{working=false;$('sendLogo').disabled=false;$('refreshShare').disabled=false;}
  };
  setInterval(()=>{if(board?.expires_at && Date.parse(board.expires_at)<=Date.now()){$('logoForm').hidden=true;message('Bảng logo đã hết hạn sau 2 giờ. Hãy xin link mới từ BTC.');}},1000);
  $('refreshShare').onclick=()=>{if(!working)load().catch(error=>message(error.message));};
  load().catch(error=>message(error.message));
})();
