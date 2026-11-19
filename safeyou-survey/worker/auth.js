const salesCookie = '__Host-survey_session';
const legacyCookie = '__Host-survey_legacy';
const authEncoder = new TextEncoder();
const authWindow = 15 * 60;

function readCookie(request, name) {
  const entry=(request.headers.get('Cookie') || '').split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='));
  return entry?.slice(name.length+1) ?? '';
}

const cookie = (name,value,age) => name+'='+value+'; Path=/; Max-Age='+age+'; HttpOnly; Secure; SameSite=Lax';
const randomToken = size => Array.from(crypto.getRandomValues(new Uint8Array(size)),b=>b.toString(16).padStart(2,'0')).join('');
const asHex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const tokenHash = async token => asHex(await crypto.subtle.digest('SHA-256',authEncoder.encode(token)));
const epochSeconds = () => Math.floor(Date.now()/1000);
const authEnabled = env => Boolean(env.SURVEY_AUTH_PEPPER);
function normalizePhone(value) {
  const input=typeof value==='string'?value.trim().replace(/[ -]/g,''):'';
  const local=input.startsWith('+82')?'0'+input.slice(3):input;
  return /^010[0-9]{8}$/.test(local)?local:'';
}

async function hashPin(pepper, salt, pin) {
  const key=await crypto.subtle.importKey('raw',authEncoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const secret=await crypto.subtle.sign('HMAC',key,authEncoder.encode(pin));
  const derived=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveBits']);
  return asHex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:authEncoder.encode(salt),iterations:100000},derived,256));
}

function equalPinHash(left, right) {
  if(left.length!==right.length)return false;
  let difference=0;
  for(let i=0;i<left.length;i++) difference|=left.charCodeAt(i)^right.charCodeAt(i);
  return difference===0;
}

async function spendAttempt(db,bucket,maximum) {
  const now=epochSeconds();
  const row=await db.prepare('INSERT INTO sales_throttle(bucket,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE MIN(attempts+1,?) END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts')
    .bind(bucket,now+authWindow,now,maximum+1,now).first();
  if(row.attempts>maximum) refuse(429,'시도 횟수가 많습니다. 15분 후 다시 시도해 주세요.');
}

async function currentIdentity(request,env) {
  const token=readCookie(request,salesCookie);
  if(/^[a-f0-9]{64}$/.test(token)&&authEnabled(env)) {
    const account=await env.DB.prepare('SELECT a.id,a.name FROM sales_session AS s JOIN sales_account AS a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires>?')
      .bind(await tokenHash(token),epochSeconds()).first();
    if(account)return {owner:'sales:'+account.id,name:account.name,legacy:false};
  }
  const platform=request.headers.get('oai-authenticated-user-id');
  if(platform&&readCookie(request,legacyCookie)==='1')return {owner:platform,name:null,legacy:true};
  return null;
}

function authResponse(data, cookies) {
  const response=json(data);
  for(const value of cookies)response.headers.append('Set-Cookie',value);
  return response;
}

async function revokeSession(request,db) {
  const token=readCookie(request,salesCookie);
  if(/^[a-f0-9]{64}$/.test(token)) {
    await db.prepare('DELETE FROM sales_session WHERE token_hash=?').bind(await tokenHash(token)).run();
  }
}

async function authAction(request,url,env) {
  if(request.method!=='POST')refuse(405,'요청 방식을 확인해 주세요.');
  const db=env.DB,action=url.pathname.slice('/api/auth/'.length);
  if(action==='logout'||action==='legacy') {
    const legacy=action==='legacy';
    if(legacy&&!request.headers.get('oai-authenticated-user-id'))refuse(401,'기존 ChatGPT 계정으로 로그인해 주세요.');
    await revokeSession(request,db);
    return authResponse({ok:true},[cookie(salesCookie,'',0),cookie(legacyCookie,legacy?'1':'',legacy?43200:0)]);
  }
  if(!['register','login'].includes(action))refuse(404,'요청한 기능을 찾을 수 없습니다.');
  if(!authEnabled(env))refuse(503,'영업자 로그인 설정을 확인해 주세요.');
  const data=await requestBody(request,2048);
  const phone=normalizePhone(data?.phone),pin=data?.pin;
  const name=typeof data?.name==='string'?data.name.trim():'';
  if(!phone||typeof pin!=='string'||!/^\d{6}$/.test(pin))refuse(400,'휴대폰번호와 6자리 PIN을 확인해 주세요.');
  const registering=action==='register';
  if(registering&&(!name||name.length>60||/[\x00-\x1f\x7f]/.test(name)))refuse(400,'이름을 60자 이하로 입력해 주세요.');

  const location=request.headers.get('CF-Connecting-IP') || request.headers.get('oai-authenticated-user-id') || 'unknown';
  await spendAttempt(db,action+':origin:'+await tokenHash(location),registering?10:30);
  const phoneBucket=action+':phone:'+await tokenHash(env.SURVEY_AUTH_PEPPER+':'+phone);
  await spendAttempt(db,phoneBucket,5);

  let account;
  if(registering) {
    const id=crypto.randomUUID(),salt=randomToken(16);
    const hash=await hashPin(env.SURVEY_AUTH_PEPPER,salt,pin);
    const insert=await db.prepare('INSERT INTO sales_account (id,name,phone,salt,pin_hash) VALUES (?,?,?,?,?) ON CONFLICT(phone) DO NOTHING')
      .bind(id,name,phone,salt,hash).run();
    if(!insert.meta.changes)refuse(409,'이미 가입된 번호입니다. 로그인 화면에서 PIN을 입력해 주세요.');
    account={id,name};
  } else {
    account=await db.prepare('SELECT id,name,salt,pin_hash FROM sales_account WHERE phone=?').bind(phone).first();
    const hash=await hashPin(env.SURVEY_AUTH_PEPPER,account?.salt ?? '00000000000000000000000000000000',pin);
    if(!account||!equalPinHash(hash,account.pin_hash))refuse(401,'휴대폰번호 또는 PIN을 확인해 주세요.');
  }

  const token=randomToken(32), age=data.keep===true?30*86400:43200;
  const now=epochSeconds();
  await revokeSession(request,db);
  await db.batch([
    db.prepare('INSERT INTO sales_session (token_hash,account_id,expires) VALUES (?,?,?)').bind(await tokenHash(token),account.id,now+age),
    db.prepare('DELETE FROM sales_throttle WHERE bucket=? OR reset_at<=?').bind(phoneBucket,now),
    db.prepare('DELETE FROM sales_session WHERE expires<=?').bind(now)
  ]);
  return authResponse({ok:true},[cookie(salesCookie,token,age),cookie(legacyCookie,'',0)]);
}
