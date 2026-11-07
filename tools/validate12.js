const fs=require('fs'),path=require('path');const E=require('../src/engine.js');
const D=process.argv[2];
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const all=walk(D);const swcs=all.filter(f=>/\.swc$/i.test(f));const csvs=all.filter(f=>/_parameters\.csv$/.test(f));
const csvByStem={};for(const c of csvs){const m=path.basename(c).match(/^(WT|AD)_M\d\d_\d{4}_(.*)_parameters\.csv$/);csvByStem[m[2]]=c;}
let worst=0,ok=0,res=[];
for(const s of swcs){const stem=path.basename(s).replace(/\.[^.]*$/,'').replace(/[^A-Za-z0-9_-]/g,'_');const c=csvByStem[stem];
 if(!c){console.log('NO CSV',s);continue;}
 const n=E.processSwc(fs.readFileSync(s,'utf8'));
 const lines=fs.readFileSync(c,'utf8').trim().split(/\r?\n/);const hdr=lines[0].split(',').map(h=>h.replace(/"/g,''));
 if(lines.length-1!==n.N){console.log('ROWCOUNT',s);continue;}
 let w=0,mism=0;
 for(let i=0;i<n.N;i++){const rv=lines[i+1].split(',');const mv=E.rowValues(n,i);
  for(let k=0;k<E.PARAM_COLS.length;k++){const a=rv[hdr.indexOf(E.PARAM_COLS[k])],b=String(mv[k]);
   if(a===b)continue;const fa=parseFloat(a),fb=parseFloat(b);
   if(Number.isFinite(fa)&&Number.isFinite(fb)){const rel=Math.abs(fa-fb)/Math.max(Math.abs(fa),1e-300);w=Math.max(w,rel);if(rel>1e-12)mism++;}else mism++;}}
 worst=Math.max(worst,w);if(!mism)ok++;res.push({file:path.basename(s),maxRel:w,mism});}
console.log('matched files',ok,'/',swcs.length,'worst rel err',worst);
fs.writeFileSync(process.argv[3],JSON.stringify(res));
