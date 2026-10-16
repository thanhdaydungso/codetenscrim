'use strict';
(() => {
  const main=document.querySelector('main');
  if(main){main.id ||= 'mainContent';const skip=document.createElement('a');skip.href='#'+main.id;skip.className='skip-link';skip.textContent='Đến nội dung chính';document.body.prepend(skip);}
  const progress=document.createElement('div');progress.className='request-progress';progress.hidden=true;progress.setAttribute('aria-hidden','true');document.body.append(progress);
  let pending=0;
  document.addEventListener('ui-request-start',()=>{pending++;progress.hidden=false;});
  document.addEventListener('ui-request-end',()=>{pending=Math.max(0,pending-1);progress.hidden=pending===0;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.code-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
  document.addEventListener('click',event=>{document.querySelectorAll('.code-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  document.querySelectorAll('.code-menu-items a').forEach(link=>{if(new URL(link.href).pathname===location.pathname){link.setAttribute('aria-current','page');}});
})();
