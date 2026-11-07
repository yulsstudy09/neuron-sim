// src/app.html + src/engine.js + SWC 149개 + 검증 결과 → dist/neuron-sim.html (단일 파일)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const dataDir = process.argv[2];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const val = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'val12.json'), 'utf8')).map(v => [v.file, v]));
const swcs = walk(dataDir).filter(f => /\.swc$/i.test(f)).sort();
const neurons = swcs.map(f => {
  const file = path.basename(f);
  const m = file.toUpperCase().match(/^(WT|AD)(06|12)/);
  const mouse = (file.match(/^((WT|AD)(06|12)[0-9]+)-/) || [])[1] || '';
  const v = val[file];
  return {
    file, name: file.replace(/(\.swc)+$/i, ''), group: m[1], age: 'M' + m[2], mouse,
    val: v ? { maxRel: v.maxRel, mism: v.mism } : null,
    text: fs.readFileSync(f, 'utf8').replace(/[ \t]+/g, ' ').replace(/^ /gm, ''),
  };
});
const data = JSON.stringify({ built: new Date().toISOString().slice(0, 10), neurons }).replace(/</g, '\\u003c');
let html = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8');
html = html.replace('/*__ENGINE__*/', () => engine).replace('__DATA__', () => data);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/neuron-sim.html'), html);
console.log('neurons', neurons.length, 'size', (html.length / 1e6).toFixed(2), 'MB');
