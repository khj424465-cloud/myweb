import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
const build=spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
if (build.status!==0) process.exit(build.status??1);
const worker=(await import('../dist/server/index.js')).default;
const sqlite=new DatabaseSync(':memory:');
const migrations = new URL('../drizzle/',import.meta.url);
for(const file of (await readdir(migrations)).filter(file=>file.endsWith('.sql')).sort()) {
  sqlite.exec(await readFile(new URL(file,migrations),'utf8'));
}
function prepare(sql) {
  const statement=sqlite.prepare(sql);
  const bind=(...args)=>({
    async first(){return statement.get(...args)||null;},
    async all(){return {results:statement.all(...args)};},
    async run(){return {meta:statement.run(...args)};}
  });
  return {bind};
}
const DB={prepare,async batch(statements){
  sqlite.exec('BEGIN');
  try {
    const result=[];
    for(const st of statements)result.push(await st.run());
    sqlite.exec('COMMIT');
    return result;
  } catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
const server=createServer(async (req,res)=>{
  const origin='http://'+req.headers.host;
  try{
    const headers=new Headers(req.headers);
    headers.set('oai-authenticated-user-id','local-survey-tester');
    if(headers.has('origin')) {
      const incoming=new URL(headers.get('origin'));
      if(incoming.host===req.headers.host)headers.set('origin',origin);
    }
    const hasBody=!['GET','HEAD'].includes(req.method);
    const request=new Request(origin+req.url,{method:req.method,headers,...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await worker.fetch(request,{DB,SURVEY_AUTH_PEPPER:'local-preview-only'});
    const responseHeaders=Object.fromEntries(response.headers);
    if(response.headers.has('Set-Cookie')) responseHeaders['set-cookie']=response.headers.getSetCookie();
    res.writeHead(response.status,responseHeaders);
    if(response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  }catch(error){console.error(error);res.writeHead(500);res.end();}
});
const portArg=process.argv.find(value=>value.startsWith('--port='));
const portPos=process.argv.indexOf('--port');
const port=Number(portArg?.slice(7)||(portPos>=0?process.argv[portPos+1]:null)||process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log('Survey preview listening on '+port));
