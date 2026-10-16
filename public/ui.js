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

// Original canvas sculpture: a lit, faceted stone with slow orbital motion.
(() => {
  const canvas=document.querySelector('#heroSculpture');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const lat=22,lon=36,vertices=[],faces=[];
  for(let y=0;y<=lat;y++){
    const phi=y/lat*Math.PI;
    for(let x=0;x<=lon;x++){
      const theta=x/lon*Math.PI*2;
      const rough=1+.12*Math.sin(theta*5+phi*8)+.055*Math.cos(theta*11-phi*6)+.035*Math.sin(theta*19+phi*17);
      vertices.push([Math.sin(phi)*Math.cos(theta)*rough*.88,Math.cos(phi)*rough*1.1,Math.sin(phi)*Math.sin(theta)*rough*.8]);
      if(y<lat&&x<lon){const a=y*(lon+1)+x,b=a+lon+1;faces.push([a,b,a+1],[a+1,b,b+1]);}
    }
  }
  let width=0,height=0,frame=0,last=0,visible=true,pointer=0;
  function draw(time){
    const t=reduced.matches ? .28 : time*.000055;
    const angle=t+pointer*.12,cos=Math.cos(angle),sin=Math.sin(angle);
    const points=vertices.map(([x,y,z])=>{const rx=x*cos+z*sin,rz=z*cos-x*sin;return [rx,y*.97-rz*.24,y*.24+rz*.97];});
    const scale=width<600?Math.min(width*.44,height*.29):Math.min(width*.23,height*.32),centerX=width*.52,centerY=height*.45;
    ctx.clearRect(0,0,width,height);
    // Soft ground shadow keeps the floating object grounded without image assets.
    ctx.save();ctx.translate(centerX,height*.83);ctx.scale(1,.12);
    const shadow=ctx.createRadialGradient(0,0,0,0,0,scale*.9);shadow.addColorStop(0,'#00000066');shadow.addColorStop(1,'#00000000');ctx.fillStyle=shadow;ctx.fillRect(-scale,-scale,scale*2,scale*2);ctx.restore();
    const triangles=faces.map(ids=>{const [a,b,c]=ids.map(i=>points[i]);const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,n=Math.hypot(nx,ny,nz)||1;return {ids,z:(a[2]+b[2]+c[2])/3,light:Math.max(0,(nx*.5+ny*.65-nz*.6)/n)};}).sort((a,b)=>a.z-b.z);
    const floatY=reduced.matches?0:Math.sin(time*.00045)*9;
    triangles.forEach(face=>{
      const value=Math.round(28+face.light*137);
      ctx.beginPath();face.ids.forEach((id,i)=>{const [x,y,z]=points[id],perspective=3.5/(3.5-z*.3);const px=centerX+x*scale*perspective,py=centerY+y*scale*perspective+floatY;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
      ctx.fillStyle='rgb('+value+','+value+','+(value+3)+')';ctx.fill();ctx.strokeStyle='rgba(210,210,220,.035)';ctx.lineWidth=.5;ctx.stroke();
    });
  }
  function tick(time){frame=0;if(!visible||document.hidden||reduced.matches)return;if(time-last>32){draw(time);last=time;}frame=requestAnimationFrame(tick);}
  function start(){if(!frame&&visible&&!document.hidden&&!reduced.matches)frame=requestAnimationFrame(tick);}
  function stop(){cancelAnimationFrame(frame);frame=0;}
  function resize(){const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;const ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);draw(6000);start();}
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;visible?start():stop();}).observe(canvas);
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  reduced.addEventListener('change',()=>{stop();draw(6000);start();});
  canvas.parentElement.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')pointer=(e.clientX/innerWidth-.5)*2;},{passive:true});
  resize();
})();

// Reveal sections once, without hiding content while scripts are loading.
(() => {
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  if(motion.matches)return;
  const animations=new Set();
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting||motion.matches)return;
    const animation=entry.target.animate([{opacity:.35,transform:'translateY(22px)'},{opacity:1,transform:'translateY(0)'}],{duration:700,easing:'cubic-bezier(.2,.7,.2,1)'});
    animations.add(animation);
    animation.finished.then(()=>animations.delete(animation)).catch(()=>animations.delete(animation));
    observer.unobserve(entry.target);
  }),{threshold:.08});
  motion.addEventListener('change',()=>{if(motion.matches){observer.disconnect();animations.forEach(animation=>animation.cancel());animations.clear();}});
  document.querySelectorAll('.section-space,.stats-grid,.form-layout>.panel,.admin-layout>.panel,.logo-main>.panel').forEach(el=>observer.observe(el));
})();
