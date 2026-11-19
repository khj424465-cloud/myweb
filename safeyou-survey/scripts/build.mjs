import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const read = file => readFile(new URL('../'+file,import.meta.url),'utf8');
const assets = {};
for (const name of ['index.html','app.css','app.js','model.js','schema.json','manifest.webmanifest','sw.js','icon-192.png','icon-512.png']) {
  const binary=name.endsWith('.png');
  const data=await readFile(new URL('../ui/'+name,import.meta.url),binary?'base64':'utf8');
  assets[name==='index.html'?'/':'/'+name]={binary,data};
}
const template=await readFile(new URL('../worker/template.xlsx',import.meta.url),'base64');
const jszip=await read('vendor/jszip.min.js');
const worker=(await read('worker/index.js')).replace(/^import[^\n]+\n/,'');
const modules=await read('ui/model.js');
const auth=await read('worker/auth.js');
const dist = new URL('../dist/',import.meta.url);
await mkdir(new URL('server/',dist),{recursive:true});
await mkdir(new URL('.openai/',dist),{recursive:true});
await copyFile(new URL('../.openai/hosting.json',import.meta.url),new URL('.openai/hosting.json',dist));
await writeFile(new URL('server/index.js',dist),[
  'const JSZip = (() => { const module = {exports:{}}; const exports = module.exports;\n'+jszip+'\nreturn module.exports; })();',
  'const SCHEMA = '+assets['/schema.json'].data+';',
  'const TEMPLATE = '+JSON.stringify(template)+';',
  'const ASSETS = '+JSON.stringify(assets)+';',
  modules,auth,worker
].join('\n'));
