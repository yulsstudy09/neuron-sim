const {chromium}=require('playwright');const path=require('path');
const OUT=process.env.OUT||'/tmp';
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1440,height:960}});const errs=[];p.on('pageerror',e=>errs.push('PAGEERR '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED/.test(m.text()))errs.push(m.text())});
await p.route('**/*',r=>{const u=r.request().url();if(u.includes('three@0.128.0')){return r.fulfill({path:path.join(__dirname,'../node_modules/three',u.split('three@0.128.0/')[1]),contentType:'application/javascript'})}if(u.startsWith('file:'))return r.continue();return r.abort()});
await p.goto('file://'+path.join(__dirname,'../index.html'));await p.waitForTimeout(2500);
await p.screenshot({path:OUT+'/s1.png'});
// 고정 전류 0.1 nA로 실행
await p.selectOption('#stimmode','fixed');await p.click('#run');await p.waitForTimeout(1500);
// 편집 탭, 선택한 노드: 뿌리 → 말단 쪽 노드 선택을 위해 자극 노드를 선택
await p.click('.tabs button[data-t=edit]');await p.waitForTimeout(300);
const st=await p.textContent('#stimtag');console.log('stim',st);
await p.evaluate(()=>{});
// 캔버스 클릭으로 아무 노드 선택
const bb=await (await p.$('#gl')).boundingBox();
for(const [fx,fy] of [[0.6,0.4],[0.55,0.45],[0.7,0.35],[0.45,0.5]]){await p.mouse.click(bb.x+bb.width*fx,bb.y+bb.height*fy);await p.waitForTimeout(200);}
const dis=await p.$eval('#e-len',e=>e.disabled);console.log('len disabled',dis);
if(!dis){await p.$eval('#e-len',e=>{e.value='2';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
await p.$eval('#e-rot',e=>{e.value='45';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});}
await p.$eval('#e-rad',e=>{e.value='0.5';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
await p.waitForTimeout(300);await p.click('#run');await p.waitForTimeout(2500);
await p.click('#rk4');await p.waitForTimeout(3000);
await p.screenshot({path:OUT+'/s2.png'});
console.log('status',await p.textContent('#status'));console.log('extra',await p.textContent('#extra'));
console.log('metrics',(await p.textContent('#metrics')).slice(0,300));
const ph=await b.newPage({viewport:{width:400,height:860}});await ph.route('**/*',r=>{const u=r.request().url();if(u.includes('three@0.128.0')){return r.fulfill({path:path.join(__dirname,'../node_modules/three',u.split('three@0.128.0/')[1]),contentType:'application/javascript'})}if(u.startsWith('file:'))return r.continue();return r.abort()});
await ph.goto('file://'+path.join(__dirname,'../index.html'));await ph.waitForTimeout(2500);await ph.screenshot({path:OUT+'/s3.png',fullPage:true});
console.log('errors',errs);await b.close();})();
