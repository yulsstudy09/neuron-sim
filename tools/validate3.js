// R 3단계 결과(node CSV, trace CSV, Results_Summary)와 JS HH 결과 비교
const fs=require('fs'),path=require('path');const E=require('../src/engine.js'),H=require('../src/hh.js');
const [rDir,swcDir]=process.argv.slice(2);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const swcs=walk(swcDir).filter(f=>/\.swc$/i.test(f));
const csv=f=>{const L=fs.readFileSync(f,'utf8').trim().split(/\r?\n/);const h=L[0].split(',').map(s=>s.replace(/"/g,''));return L.slice(1).map(l=>{const v=l.split(',');const o={};h.forEach((k,i)=>o[k]=v[i]?.replace(/"/g,''));return o;});};
const sum=csv(path.join(rDir,'Results_Summary.csv'));
for(const row of sum){
  const stem=row.File_Name.replace(/^(WT|AD)_M\d\d_\d{4}_/,'').replace(/_parameters\.csv$/,'');
  const swc=swcs.find(f=>path.basename(f).replace(/\.[^.]*$/,'').replace(/[^A-Za-z0-9_-]/g,'_')===stem);
  const n=E.processSwc(fs.readFileSync(swc,'utf8'));const t0=Date.now();const r=H.simulate(n);const ms=Date.now()-t0;
  const node=csv(path.join(rDir,row.Group,row.File_Name.replace(/_parameters\.csv$/,'')+'_node_exponential_euler.csv'));
  let w=0;node.forEach((o,i)=>{const a=+o.Peak_Depolarization_mV,b=r.peak[i];w=Math.max(w,Math.abs(a-b)/Math.max(Math.abs(a),1e-6));});
  const tr=csv(path.join(rDir,row.Group,row.File_Name.replace(/_parameters\.csv$/,'')+'_voltage_trace.csv'));
  let wt=0;tr.forEach((o,k)=>{wt=Math.max(wt,Math.abs(+o.Stim_V_mV-r.V[(k+1)*n.N+r.stim]),Math.abs(+o.Proximal_V_mV-r.V[(k+1)*n.N+r.prox]));});
  console.log(stem,'| stim',row.Stim_Node_ID,'vs',n.id[r.stim],'| prox',row.Proximal_Node_ID,'vs',n.id[r.prox],
   '| ratio R',(+row.Relative_Peak_Ratio).toPrecision(8),'JS',r.ratio.toPrecision(8),'| peak maxRel',w.toExponential(1),'| trace maxAbs(mV, float32)',wt.toExponential(1),'|',ms,'ms');
}
