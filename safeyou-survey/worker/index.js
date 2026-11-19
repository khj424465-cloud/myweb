import {allFields, businessNumberField, businessNumberDigits, fieldError, fileLimit, fileTypes, normalize, proofSlots, surveyFileTitle, validate} from '../ui/model.js';

const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class Problem extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
const refuse = (status,message) => { throw new Problem(status,message); };
const slotNames = {accident:'무재해증빙',insurance:'4대보험가입자명부',registration:'사업자등록증'};
const missing = '조사서를 찾을 수 없습니다.';
const fields = allFields(SCHEMA);
const attachmentChunk = 120000;
const mimeFor = name => ({
  '/':'text/html; charset=utf-8','/app.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8',
  '/model.js':'text/javascript; charset=utf-8','/sw.js':'text/javascript; charset=utf-8',
  '/schema.json':'application/json; charset=utf-8','/manifest.webmanifest':'application/manifest+json; charset=utf-8',
  '/icon-192.png':'image/png','/icon-512.png':'image/png'
})[name];

async function owned(db,id,owner) {
  const row = await db.prepare('SELECT * FROM survey WHERE id=? AND owner=?').bind(id,owner).first();
  if (!row) refuse(404,missing);
  return row;
}

async function fileMetadata(db,id) {
  const {results} = await db.prepare('SELECT slot,name,mime,size FROM evidence WHERE survey_id=? AND idx=0').bind(id).all();
  return Object.fromEntries(results.map(({slot,...meta})=>[slot,meta]));
}

function view(row, files={}) {
  return {id:row.id, cells:JSON.parse(row.payload),status:row.status,version:row.version,updated:row.updated,sentAt:row.sent_at,files};
}

function checkFile(slot, file) {
  if (!proofSlots.includes(slot)) refuse(400,'첨부 유형을 확인해 주세요.');
  if (file === null) return;
  if (!file || !Object.hasOwn(fileTypes,file.mime) || typeof file.base64 !== 'string' ||
      !Number.isInteger(file.size) || file.size < 1 || file.size > fileLimit ||
      file.base64.length !== 4 * Math.ceil(file.size/3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)) {
    refuse(400,'첨부는 파일당 2MB 이하의 PDF, JPG, PNG를 사용할 수 있습니다.');
  }
  const raw = atob(file.base64.slice(0,16));
  const matches = {'application/pdf':raw.startsWith('%PDF-'),'image/jpeg':raw.startsWith('\xff\xd8\xff'),'image/png':raw.startsWith('\x89PNG\r\n\x1a\n')};
  if (!matches[file.mime]) refuse(400,'첨부 파일의 내용과 형식이 일치하지 않습니다.');
  if (((file.base64.length / 4) * 3) - (file.base64.match(/=+$/)?.[0].length ?? 0) !== file.size) refuse(400,'첨부 파일 크기를 확인해 주세요.');
}

async function requestBody(request, maximum=9_000_000) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) refuse(415,'요청 형식을 확인해 주세요.');
  const reader = request.body?.getReader();
  if (!reader) refuse(400,'요청 내용이 없습니다.');
  const decoder = new TextDecoder();
  let text='', size=0;
  for (;;) {
    const part=await reader.read();
    if (part.done) break;
    size+=part.value.length;
    if (size>maximum) { await reader.cancel(); refuse(413,'첨부 파일의 용량을 확인해 주세요.'); }
    text+=decoder.decode(part.value,{stream:true});
  }
  try { return JSON.parse(text+decoder.decode()); } catch { refuse(400,'요청 형식을 확인해 주세요.'); }
}

async function save(request,env,id,owner) {
  const body = await requestBody(request);
  if (!body || !['draft','saved'].includes(body.status) || !body.cells || typeof body.cells !== 'object' || Array.isArray(body.cells) ||
      (body.version !== null && (!Number.isInteger(body.version) || body.version < 1))) refuse(400,'조사서 정보를 확인해 주세요.');
  const cells = {};
  for (const [key,value] of Object.entries(body.cells)) {
    if (!fields.has(key) || typeof value !== 'string' || value.length>500) refuse(400,'입력 항목을 확인해 주세요.');
    if (value.trim()) cells[key]=value.trim();
  }
  normalize(SCHEMA,cells);
  const businessNumber = cells[businessNumberField];
  if (businessNumber && businessNumberDigits(businessNumber)!==businessNumber) refuse(400,'사업자등록번호는 숫자 10자리까지만 입력해 주세요.');
  const payload = JSON.stringify(cells);
  if (new TextEncoder().encode(payload).byteLength > 300000) refuse(413,'조사서의 전체 입력 용량을 줄여 주세요.');
  const changes = Object.entries(body.files ?? {});
  for (const [slot,file] of changes) checkFile(slot,file);
  const db=env.DB;
  const files = body.version === null ? {} : await fileMetadata(db,(await owned(db,id,owner)).id);
  for (const [slot,file] of changes) {
    if (file) {
      const extension = fileTypes[file.mime];
      files[slot] = {name:slotNames[slot]+'.'+extension,mime:file.mime,size:file.size};
    } else delete files[slot];
  }
  if (body.status==='saved' && validate(SCHEMA,cells,files).some(list=>list.length)) refuse(422,'검토 및 제출에서 누락 항목을 확인해 주세요.');
  const updated=new Date().toISOString(), revision=crypto.randomUUID();
  const statement = body.version === null
    ? db.prepare('INSERT INTO survey (id,owner,payload,status,version,revision,updated) VALUES (?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id,owner,payload,body.status,revision,updated)
    : db.prepare("UPDATE survey SET payload=?,status=?,version=version+1,revision=?,updated=? WHERE id=? AND owner=? AND version=? AND status IN ('draft','saved')")
      .bind(payload,body.status,revision,updated,id,owner,body.version);
  const writes=[statement];
  for (const [slot,file] of changes) {
    writes.push(db.prepare('DELETE FROM evidence WHERE survey_id=? AND slot=? AND EXISTS (SELECT 1 FROM survey WHERE id=? AND owner=? AND revision=?)').bind(id,slot,id,owner,revision));
    if (!file) continue;
    for (let offset=0,index=0;offset<file.base64.length;offset+=attachmentChunk,index++) {
      const meta=files[slot];
      writes.push(db.prepare('INSERT INTO evidence SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM survey WHERE id=? AND owner=? AND revision=?)')
        .bind(id,slot,index,meta.name,file.mime,file.size,file.base64.slice(offset,offset+attachmentChunk),id,owner,revision));
    }
  }
  const [result] = await db.batch(writes);
  if (!result.meta.changes) refuse(409,'다른 화면에서 변경된 조사서입니다. 입력 내용을 확인한 뒤 조사서를 다시 열어 주세요.');
  return json({id,cells,files,status:body.status,version:(body.version??0)+1,updated,sentAt:null});
}

const escapeXml = value => value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g,'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function excelValue(field,value) {
  if (fieldError(field,value)==='') {
    if (field.kind==='number') return ['n',String(Number(value))];
    if (field.kind==='date') return ['n',String((Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000)];
  }
  return ['inlineStr','<is><t xml:space="preserve">'+escapeXml(value)+'</t></is>'];
}
async function spreadsheet(cells,format) {
  const zip = await JSZip.loadAsync(TEMPLATE,{base64:true});
  const stableDate = new Date('2026-11-17T00:00:00Z');
  for (let sheet=2;sheet<=8;sheet++) {
    const path='xl/worksheets/sheet'+sheet+'.xml';
    const xml=await zip.file(path).async('string');
    const updated=xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(original,attributes)=>{
      const address=attributes.match(/\br="([A-Z]+[0-9]+)"/)?.[1];
      const key=sheet+':'+address;
      if (!Object.hasOwn(cells,key)) return original;
      const [type,value]=excelValue(fields.get(key),cells[key]);
      return '<c'+attributes.replace(/\st="[^"]*"/g,'')+' t="'+type+'">'+(type==='n'?'<v>'+value+'</v>':value)+'</c>';
    });
    zip.file(path,updated,{date:stableDate});
  }
  const workbook='xl/workbook.xml';
  const book=await zip.file(workbook).async('string');
  zip.file(workbook,book.replace(/<calcPr\b[^>]*\/>/,'<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>'),{date:stableDate});
  return zip.generateAsync({type:format,compression:'DEFLATE'});
}
const mailReady = env => Boolean(env.RESEND_API_KEY && env.MAIL_FROM && env.MAIL_TO);
async function send(env,row,owner) {
  if (row.status==='sent') return {sentAt:row.sent_at};
  if (!mailReady(env)) refuse(503,'아직 발송 환경이 연결되지 않았습니다. 저장한 엑셀을 내려받을 수 있습니다.');
  if (!['saved','sending'].includes(row.status)) refuse(409,'조사서를 먼저 저장해 주세요.');
  const db=env.DB;
  if (row.status === 'saved') {
    const claim=await db.prepare("UPDATE survey SET status='sending' WHERE id=? AND owner=? AND version=? AND status='saved'").bind(row.id,owner,row.version).run();
    if (!claim.meta.changes) refuse(409,'조사서가 변경되었습니다. 조사서를 다시 열어 주세요.');
  }
  const cells=JSON.parse(row.payload), title=surveyFileTitle(cells,row.updated);
  const {results} = await db.prepare('SELECT slot,name,content FROM evidence WHERE survey_id=? ORDER BY slot,idx').bind(row.id).all();
  const files = new Map();
  for (const {name:filename,content} of results) files.set(filename,(files.get(filename)??'')+content);
  const attachments=[{filename:title+'.xlsx',content:await spreadsheet(cells,'base64')},...Array.from(files,([filename,content])=>({filename,content}))];
  let result;
  try {
    result=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(16000),headers:{
        Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'survey/'+row.id+'/'+row.version
      },body:JSON.stringify({
        from:env.MAIL_FROM,to:[env.MAIL_TO],subject:title,
        text:'사업장 기초조사서를 첨부합니다. 접수 번호: '+row.id,attachments
      })
    });
  } catch { refuse(502,'메일 발송 결과를 확인하지 못했습니다. 잠시 후 발송을 다시 눌러 주세요.'); }
  if (!result.ok) {
    if ([400,401,403,404,422].includes(result.status)) {
      await db.prepare("UPDATE survey SET status='saved' WHERE id=? AND owner=? AND version=? AND status='sending'").bind(row.id,owner,row.version).run();
    }
    refuse(502,'메일 발송 서비스에서 요청을 처리하지 못했습니다. 발송 설정을 확인한 뒤 다시 시도해 주세요.');
  }
  const stamp=new Date().toISOString();
  await db.prepare("UPDATE survey SET status='sent',sent_at=? WHERE id=? AND owner=? AND version=? AND status='sending'").bind(stamp,row.id,owner,row.version).run();
  return {sentAt:(await owned(db,row.id,owner)).sent_at};
}

async function api(request,url,env) {
  if (!env.DB) refuse(503,'저장 서비스에 연결할 수 없습니다.');
  if (request.method!=='GET' && request.headers.get('Origin') !== url.origin) refuse(403,'요청 주소를 확인해 주세요.');
  if (url.pathname.startsWith('/api/auth/')) return authAction(request,url,env);
  const identity=await currentIdentity(request,env);
  if (url.pathname==='/api/session' && request.method==='GET') {
    const account=identity?{name:identity.name,legacy:identity.legacy}:null;
    return json({account,canUseLegacy:Boolean(request.headers.get('oai-authenticated-user-id')),canUseSales:authEnabled(env),
      mailReady:Boolean(account)&&mailReady(env),recipient:account?env.MAIL_TO||null:null});
  }
  if (!identity) refuse(401,'로그인 후 조사서를 확인할 수 있습니다.');
  const owner=identity.owner;
  if (url.pathname==='/api/surveys' && request.method==='GET') {
    const {results}=await env.DB.prepare("SELECT id,updated,status,sent_at AS sentAt,json_extract(payload,'$.\"2:C6\"') AS name FROM survey WHERE owner=? ORDER BY updated DESC").bind(owner).all();
    return json(results);
  }
  const match=url.pathname.match(/^\/api\/surveys\/([a-f0-9-]{36})(?:\/(xlsx|send))?$/);
  if (!match) refuse(404,'요청한 기능을 찾을 수 없습니다.');
  const [,id,action]=match;
  if (request.method==='PUT' && !action) return save(request,env,id,owner);
  const row=await owned(env.DB,id,owner);
  if (request.method==='GET' && !action) return json(view(row,await fileMetadata(env.DB,id)));
  if (request.method==='POST' && action==='send') return json(await send(env,row,owner));
  if (request.method==='GET' && action==='xlsx') {
    const cells=JSON.parse(row.payload);
    const data=await spreadsheet(cells,'uint8array');
    return new Response(data,{headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':"attachment; filename=survey.xlsx; filename*=UTF-8''"+encodeURIComponent(surveyFileTitle(cells,row.updated)+'.xlsx').replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    }});
  }
  refuse(405,'요청 방식을 확인해 주세요.');
}
export default {
  async fetch(request,env) {
    const headers = new Headers(request.headers);
    headers.delete('oai-authenticated-user-id');
    request = new Request(request, { headers });
    const url=new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request,url,env);
      const asset = ASSETS[url.pathname];
      if (!asset || !mimeFor(url.pathname)) return new Response('페이지를 찾을 수 없습니다.',{status:404});
      const body = asset.binary ? Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)) : asset.data;
      return new Response(body,{headers:{
        'Content-Type':mimeFor(url.pathname),'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'same-origin',
        'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'"
      }});
    } catch (error) {
      if (error instanceof Problem) return json({error:error.message},error.status);
      console.error('survey request failed',error.name,error.message?.slice(0,200));
      return json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);
    }
  }
};
