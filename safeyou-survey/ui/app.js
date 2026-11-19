import {activeRows,businessNumberDigits,businessNumberField,businessNumberLimit,budgetAmount,fileLimit,fileTypes,groups,normalize,proofSlots,rowFields,steps,surveyFileTitle,validate} from '/model.js';

const root=document.querySelector('#app');
const notice=document.querySelector('#notice');
const topActions=document.querySelector('.top-actions');
const states={draft:'임시저장',saved:'발송 대기',sending:'발송 확인 중',sent:'발송 완료'};
const fileLabels=['무재해 증빙','4대보험 가입자명부','사업자등록증'];
const state={page:'auth',authMode:'login',listMode:'draft',step:0,busy:false,dirty:false,cells:{},files:{},pending:{},rows:{},open:{},list:[],version:null,status:'draft',id:crypto.randomUUID()};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=date=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(date));
const locked=()=>['sending','sent'].includes(state.status);
let schema,session,toastTimer;
const money=new Intl.NumberFormat('ko-KR');

function msg(message,error=false) {
  notice.textContent=message; notice.classList.toggle('error',error); notice.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{notice.hidden=true;},4800);
}
async function api(path,options) {
  const response=await fetch(path,{...options,cache:'no-store'});
  const type=response.headers.get('Content-Type')||'';
  const data=type.includes('application/json')?await response.json():null;
  if(!response.ok || !data) throw new Error(data?.error||'서버에 연결하지 못했습니다. 다시 시도해 주세요.');
  return data;
}
const surveyPath=()=>'/api/surveys/'+state.id;
const mergedFiles=()=>{
  const files={...state.files};
  for(const [slot,file] of Object.entries(state.pending)) {
    if(file) files[slot]=file; else delete files[slot];
  }
  return files;
};
const checked=()=>validate(schema,normalize(schema,{...state.cells}),mergedFiles());
const btn=(action,text,klass='',disabled=false)=>'<button type="button" class="btn '+klass+'" data-action="'+action+'"'+(disabled?' disabled':'')+'>'+text+'</button>';
const selected=(value,option)=>value===option?' selected':'';
const mark=required=>required?'<span class="required" aria-label="필수">*</span>':'';
const field=(f,overrides={})=>{
  const value=state.cells[f.id]??'';
  const extra=' data-field="'+f.id+'" id="field-'+f.id+'"'+(locked()||overrides.disabled?' disabled':'')+(f.required?' aria-required="true"':'');
  const type={number:'number',date:'date',email:'email',tel:'tel'}[f.kind]??'text';
  const element=f.kind==='select'
    ? '<select class="control"'+extra+'><option value="">선택해 주세요</option>'+f.options.map(o=>'<option'+selected(value,o)+'>'+esc(o)+'</option>').join('')+'</select>'
    : '<input class="control"'+extra+' type="'+type+'" value="'+esc(value)+'" maxlength="'+(f.kind==='business'?businessNumberLimit:500)+'"'+(f.kind==='business'?' inputmode="numeric" pattern="[0-9]{10}"':'')+(f.kind==='number'?' min="'+(f.min??0)+'" step="1"':'')+(f.kind==='person'?' list="staff-names"':'')+(f.placeholder?' placeholder="'+esc(f.placeholder)+'"':'')+'>';
  return '<label class="field'+(f.wide?' wide':'')+'"><span>'+esc(f.label)+mark(f.required)+'</span>'+element+'</label>';
};
const grid=(fields,overrides)=>'<div class="form-grid">'+fields.map(f=>field(f,overrides)).join('')+'</div>';
const group=(title,content)=>'<section class="group"><h3>'+esc(title)+'</h3>'+content+'</section>';
const choices=(fields,radio='',tiles=false)=>'<div class="options'+(tiles?' tiles':'')+'">'+fields.map(f=>
  '<label class="choice"><input type="'+(radio?'radio':'checkbox')+'" '+(radio?'name="'+radio+'" ':'')+'data-field="'+f.id+'" id="field-'+f.id+'"'+(state.cells[f.id]==='●'?' checked':'')+(locked()?' disabled':'')+'><span><b>'+esc(f.label)+'</b>'+(f.note?'<small>'+esc(f.note)+'</small>':'')+'</span></label>'
).join('')+'</div>';

function repeat(name) {
  const g=groups[name], rows=state.rows[name]||[];
  return rows.map((row,i)=>{
    const fields=rowFields(schema[g.schema],g.sheet,row);
    const display=state.cells[fields[0].id];
    return '<details class="repeat" data-card="'+name+':'+row+'"'+(state.open[name]?.has(row)?' open':'')+
      '><summary>'+esc(g.title+' '+(i+1))+(display?' · '+esc(display):'')+'</summary><div class="repeat-body">'+grid(fields)+
      (locked()?'':'<div class="repeat-foot"><button class="btn remove" data-action="remove" data-name="'+name+'" data-row="'+row+'">삭제</button></div>')+'</div></details>';
  }).join('')+(locked()||rows.length>=g.end-g.start+1?'':'<button class="btn subtle" data-action="add" data-name="'+name+'">＋ '+g.title+' 추가</button>');
}
function proof() {
  const files=mergedFiles();
  return group('증빙 서류',grid(schema.proof)+
    '<div class="evidence-list">'+proofSlots.map((slot,i)=>{
      const has=files[slot];
      return '<div class="evidence-row"><span>'+fileLabels[i]+(has?' · <span class="upload-meta">'+esc(has.name)+'</span>':'')+'</span>'+
        (locked()?'':'<span><input id="file-'+slot+'" data-slot="'+slot+'" type="file" accept="application/pdf,image/jpeg,image/png" hidden><label tabindex="0" role="button" for="file-'+slot+'">'+(has?'교체':'첨부')+'</label>'+
        (has?' <button class="btn remove" data-action="remove-file" data-slot="'+slot+'">삭제</button>':'')+'</span>')+'</div>';
    }).join('')+'</div><p class="hint" style="margin-top:8px">PDF, JPG, PNG · 파일당 최대 2MB</p>');
}
function review(errors) {
  const editNotice=state.attempted && errors.flat().length?'<div class="banner warn">아래에서 입력이 필요한 단계로 이동해 주세요.</div>':'';
  const recipient=esc(session.recipient);
  const email=state.status==='sent'?'<div class="banner">메일 발송 요청이 처리되었습니다. '+esc(fmt(state.sentAt))+'</div>'
    : session.mailReady?'<div class="banner">발송하면 <b>'+recipient+'</b>에 사업장 조사서와 증빙 파일을 보냅니다.</div>'
    : session.recipient?'<div class="banner">엑셀을 내려받은 뒤 메일 앱을 열어 파일을 첨부하고 보내 주세요. 수신 주소는 <b>'+recipient+'</b>입니다.</div>'
    : '<div class="banner">저장한 엑셀을 내려받을 수 있습니다. 이메일 발송에는 수신 주소를 설정해야 합니다.</div>';
  const title=state.version&&!state.dirty?surveyFileTitle(state.cells,state.updated):'';
  const manualMail=!session.mailReady&&session.recipient&&title&&state.status==='saved'
    ? ' <a class="btn primary" id="manual-mail" href="mailto:'+esc(encodeURIComponent(session.recipient).replace('%40','@'))+
      '?subject='+esc(encodeURIComponent(title))+'">메일 앱 열기</a>'
    : '';
  return editNotice+group('입력 현황',
    '<div class="checks">'+steps.map((item,i)=>'<div class="check-row"><span>'+esc(item[0])+'</span>'+
      (errors[i].length?'<button data-action="issue" data-step="'+i+'">확인 '+errors[i].length+'건 ↗</button>':'<span class="ok">✓ 확인</span>')+'</div>').join('')+'</div>')+
    group('작성·확인 정보',grid(schema.review))+
    '<div class="group">'+email+(title?'<p class="hint" id="survey-file-title">엑셀 파일명 <b>'+esc(title)+'.xlsx</b></p>':'')+
    (state.version?'<a class="btn" href="'+surveyPath()+'/xlsx">↓ 저장한 엑셀 내려받기</a>':'')+manualMail+'</div>';
}
function body(errors) {
  switch(state.step) {
    case 0: return group('기업 기초정보',grid(schema.basic))+group('담당자 정보 (관리감독자)',grid(schema.contact))+proof();
    case 1: return group('평가 방법론',choices(schema.methods,'method'))+
      (state.cells['3:C7']?' '+group('개선이 필요한 위험 수준',choices(schema.levels,'level')):'');
    case 2: {
      const fields=rowFields(schema.persons,4,7).filter(f=>f.col!=='G');
      return group('대표자 정보',grid([schema.same])+'<div style="height:12px"></div><div class="form-grid">'+fields.map(f=>field({...f,required:['C','D'].includes(f.col)},{disabled:state.cells['4:F4']==='예'&&['C','D','E','F'].includes(f.col)})).join('')+'</div>')+
        group('직원명부',repeat('employees')||'<p class="hint">등록된 직원이 없습니다.</p>');
    }
    case 3: return group('주요 위험요인',choices(schema.risks,'',true))+
      group('보유 기계·설비',choices(schema.equipment,'',true)+'<div style="margin-top:11px">'+grid(schema.equipmentExtra)+'</div>')+
      group('취급 화학물질',choices(schema.chemicals,'',true)+'<div style="margin-top:11px">'+grid(schema.chemicalExtra)+'</div>')+
      group('취급 화학물질 상세',repeat('materials')||'<p class="hint">등록된 상세 항목이 없습니다.</p>')+
      group('현장 확인','<p class="hint">선택한 위험요인, 기계·설비, 화학물질이 실제 사업장 현황과 일치하는지 담당자와 확인해 주세요.</p>'+choices([schema.confirmation]));
    case 4: return group('공정별 담당자와 참여 근로자','<p class="hint">직원명부의 이름을 선택하거나 직접 입력할 수 있습니다.</p>'+repeat('processes')+
      '<datalist id="staff-names">'+activeRows(schema,state.cells,groups.employees).map(r=>'<option value="'+esc(state.cells['4:C'+r])+'">').join('')+'</datalist>');
    case 5: {
      const mode=state.cells['7:D6'];
      return group('기준과 산정 방식',grid([schema.year,schema.budgetMode]))+
        (mode===schema.budgetMode.options[1]?group('총액 입력',grid([schema.budgetTotal])+'<p class="hint">입력한 총액을 조사서에 저장합니다. 항목별 배분은 안전해YOU 연동 단계에서 적용합니다.</p>'):
        mode===schema.budgetMode.options[0]?group('항목별 예산',schema.budgetKinds.map((name,i)=>{
          const row=13+i;
          return '<details class="repeat" data-card="budget:'+row+'"'+(state.open.budget?.has(row)?' open':'')+'><summary>'+esc(name)+'<span data-budget="'+row+'"> · '+money.format(Number(state.cells['7:E'+row]||0))+'원</span></summary><div class="repeat-body">'+
            (schema.budgetExamples[i]?'<p class="hint">'+esc(schema.budgetExamples[i])+'</p>':'')+grid(rowFields(schema.budget,7,row))+'</div></details>';
        }).join('')+'<p id="budget-sum" class="summary-total">합계 '+money.format(budgetAmount(schema,state.cells))+'원</p>'):'');
    }
    default: return review(errors);
  }
}
function badge(status,label=states[status]) {return '<span class="badge '+status+'">'+esc(label)+'</span>';}
function progress(errors) {
  const done=errors.filter((e,i)=>!e.length&&(i!==6||errors.slice(0,6).every(a=>!a.length))).length;
  const percent=Math.round(done/7*100);
  return '<div class="rail-head"><div class="rail-line"><strong>작성 진행률</strong><span>'+done+' / 7 단계</span></div><div class="progress" role="progressbar" aria-label="작성 진행률" aria-valuenow="'+percent+'"><i style="width:'+percent+'%"></i></div></div>';
}
function renderAuth() {
  const registering=state.authMode==='register';
  const phone='<label class="field"><span>휴대폰번호</span><input class="control" type="tel" name="phone" autocomplete="tel" placeholder="010-1234-5678" maxlength="20" required></label>';
  const pin='<label class="field"><span>6자리 PIN</span><input class="control" type="password" name="pin" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" autocomplete="'+
    (registering?'new-password':'current-password')+'" required></label>';
  root.innerHTML='<section class="auth-card panel"><div class="panel-head"><div><h2>'+ (registering?'영업자 회원가입':'영업자 로그인')+'</h2><p>'+
    (registering?'이름과 휴대폰번호를 입력하고 사용할 PIN을 정해 주세요.':'휴대폰번호와 PIN으로 내 기초조사서를 확인하세요.')+'</p></div></div><div class="panel-body">'+
    (session.canUseSales?'<form id="sales-auth" class="auth-form">'+
      (registering?'<label class="field"><span>이름</span><input class="control" name="name" autocomplete="name" maxlength="60" required></label>':'')+
      phone+pin+'<label class="auth-keep"><input type="checkbox" name="keep"> 이 기기에서 로그인 유지</label><button class="btn primary" type="submit">'+(registering?'가입하고 로그인':'로그인')+'</button></form>'+
      '<div class="auth-links">'+btn('auth-mode',registering?'로그인 화면으로':'회원가입','flat')+'</div>':'<p class="hint">영업자 로그인 설정을 확인해 주세요.</p>')+
    (session.canUseLegacy?'<div class="auth-links">'+btn('legacy','기존 ChatGPT 계정의 조사서 열기','flat')+'</div>':'')+'</div></section>';
}

function renderList() {
  const draft=state.listMode==='draft';
  const records=state.list.filter(item=>draft?item.status==='draft':item.status!=='draft');
  const tab=(mode,label,isCurrent)=>'<button class="btn '+(isCurrent?'subtle':'flat')+'" data-action="list-mode" data-mode="'+mode+'" aria-pressed="'+isCurrent+'">'+label+'</button>';
  root.innerHTML='<section class="hero"><div><h1>내 기초조사서</h1><p>'+
    (session.account.name?esc(session.account.name)+'님의 조사서입니다.':'저장한 사업장 조사서를 확인할 수 있습니다.')+
    '</p></div>'+btn('new','＋ 새 조사서','primary')+'</section>'+
    '<div class="list-tabs" aria-label="조사서 상태">'+tab('draft','임시저장',draft)+tab('complete','작성 완료',!draft)+'</div>'+
    '<section class="list-panel">'+(records.length?records.map(item=>'<div class="list-row"><div><h2>'+esc(item.name||'사업장명 미입력')+'</h2><small>최근 저장 '+esc(fmt(item.updated))+'</small></div>'+
    badge(item.status,item.status==='saved'?'작성 완료':states[item.status])+
    '<div class="list-row-actions"><button class="btn" data-action="open" data-id="'+esc(item.id)+'">'+(draft?'이어쓰기':'열기')+'</button>'+
    (draft?'':'<a class="btn subtle" href="/api/surveys/'+esc(item.id)+'/xlsx" aria-label="'+esc(item.name||'조사서')+' 엑셀 다운로드">엑셀 다운로드</a>')+'</div></div>').join(''):
    '<p class="empty">'+(draft?'임시저장한 조사서가 없습니다.':'작성 완료한 조사서가 없습니다.')+'</p>')+'</section>';
}

function render() {
  root.setAttribute('aria-busy',String(state.busy));
  topActions.hidden=!session?.account;
  if (state.page==='auth') {renderAuth();return;}
  if (state.page==='list') {renderList();return;}
  const errors=checked(), step=state.step, [title,subtitle]=steps[step];
  const warnings=state.showIssues&&errors[step].length?'<div class="banner warn"><strong>확인이 필요한 항목</strong><ul>'+errors[step].map(issue=>'<li>'+esc(issue.label)+' · '+esc(issue.message)+'</li>').join('')+'</ul></div>':'';
  root.innerHTML='<section class="hero"><div><h1>사업장 기초조사</h1><p>안전해YOU 도입에 필요한 사업장 정보를 작성하세요.</p></div><div class="hero-state">'+
    badge(state.status,state.dirty?'작성 중':state.version?states[state.status]:'새 조사서')+
    (state.updated?'<small>최근 저장 '+esc(fmt(state.updated))+'</small>':'')+'</div></section>'+
    '<div class="workspace"><aside class="rail"><div id="progress-info">'+progress(errors)+'</div><nav class="steps" aria-label="조사서 작성 단계">'+
    steps.map(([name],i)=>'<button class="step'+(i===step?' current':'')+(!errors[i].length&&i!==6?' done':'')+'" data-action="step" data-step="'+i+'" aria-label="'+(i+1)+'단계 '+esc(name)+'"'+(i===step?' aria-current="step"':'')+'><span class="step-num">'+(i+1)+'</span><span class="step-label">'+esc(name)+'</span></button>').join('')+'</nav></aside>'+
    '<section class="panel"><div class="panel-head"><span class="step-tag" aria-hidden="true">'+String(step+1).padStart(2,'0')+'</span><div><h2 tabindex="-1">'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></div></div><div class="panel-body">'+warnings+body(errors)+'</div>'+
    '<div class="panel-foot">'+(step>0?btn('back','‹ 이전','flat',state.busy):'<span></span>')+'<div class="actions">'+
    (!locked()?btn('draft','임시저장','',state.busy):'')+
    (step<6?btn('next','다음 단계 ›','primary',state.busy):
      (locked()?'':btn('save','저장','subtle',state.busy))+
      (!session.mailReady||state.status==='sent'?'':btn('send','발송','primary',state.busy||state.dirty||!['saved','sending'].includes(state.status))))+'</div></div></section></div>';
  const current=root.querySelector('.step.current');
  if(current&&matchMedia('(max-width: 660px)').matches) current.parentElement.scrollLeft=Math.max(0,current.offsetLeft-58);
}
function refreshProgress() {
  const errors=checked();
  const el=document.querySelector('#progress-info');
  if(el) el.innerHTML=progress(errors);
  const badgeEl=root.querySelector('.hero-state .badge');
  if(badgeEl){badgeEl.className='badge';badgeEl.textContent='작성 중';}
  root.querySelector('[data-action="send"]')?.setAttribute('disabled','');
  document.getElementById('manual-mail')?.setAttribute('hidden','');
  document.getElementById('survey-file-title')?.setAttribute('hidden','');
}
function editCell(input) {
  if(locked()||state.busy)return;
  const id=input.dataset.field;
  if(id===businessNumberField) {
    const digits=businessNumberDigits(input.value);
    if(digits!==input.value) {
      const caret=businessNumberDigits(input.value.slice(0,input.selectionStart)).length;
      input.value=digits;
      input.setSelectionRange(caret,caret);
    }
  }
  const isRadio=input.type==='radio';
  if(isRadio) for (const node of root.querySelectorAll('input[name="'+input.name+'"]')) delete state.cells[node.dataset.field];
  const value=isRadio||input.type==='checkbox'?(input.checked?'●':''):input.value;
  if(value==='') delete state.cells[id];else state.cells[id]=value;
  state.dirty=true;
  if(isRadio||['4:F4','7:D6'].includes(id)) {
    normalize(schema,state.cells); render(); document.getElementById('field-'+id)?.focus({preventScroll:true});
  } else {
    refreshProgress();
    if(id.startsWith('7:E')) {
      const row=id.slice(3), node=root.querySelector('[data-budget="'+row+'"]');
      if(node) node.textContent=' · '+money.format(Number(value||0))+'원';
      const sum=root.querySelector('#budget-sum');
      if(sum) sum.textContent='합계 '+money.format(budgetAmount(schema,state.cells))+'원';
    }
    const summary=input.closest('.repeat')?.querySelector('summary');
    if(summary&&/^4:C|^5:B|^6:C/.test(id)) {
      const card=summary.parentElement.dataset.card, [name,row]=card.split(':');
      if(groups[name]) summary.textContent=groups[name].title+' '+(state.rows[name].indexOf(Number(row))+1)+(value?' · '+value:'');
    }
  }
}
root.addEventListener('paste',event=>{
  const input=event.target;
  if(input.dataset.field!==businessNumberField||!event.clipboardData||locked()||state.busy)return;
  event.preventDefault();
  const start=input.selectionStart, end=input.selectionEnd;
  const available=businessNumberLimit-(input.value.length-(end-start));
  const digits=businessNumberDigits(event.clipboardData.getData('text')).slice(0,available);
  if(!digits)return;
  input.setRangeText(digits,start,end,'end');
  editCell(input);
});
root.addEventListener('input',event=>{
  if(event.target.matches('input[data-field]:not([type="radio"]):not([type="checkbox"])')) editCell(event.target);
});
root.addEventListener('change',async event=>{
  const input=event.target;
  if(input.matches('select[data-field],input[type="radio"][data-field],input[type="checkbox"][data-field]')) {editCell(input);return;}
  if(!input.matches('input[type="file"][data-slot]')||!input.files.length||locked()||state.busy) return;
  const file=input.files[0], slot=input.dataset.slot;
  if(!Object.hasOwn(fileTypes,file.type)||file.size>fileLimit||file.size<1) {msg('2MB 이하의 PDF, JPG, PNG를 첨부해 주세요.',true);return;}
  await work(async()=>{
    const base64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('첨부 파일을 읽지 못했습니다.'));
      reader.readAsDataURL(file);
    });
    state.pending[slot]={name:file.name,mime:file.type,size:file.size,base64};
    const i=proofSlots.indexOf(slot);
    state.cells[schema.proof[i].id]=schema.proof[i].options[i===0?1:0];
    state.dirty=true;
  });
});
root.addEventListener('toggle',event=>{
  const node=event.target;
  if(!node.dataset.card||!node.isConnected)return;
  const [name,row]=node.dataset.card.split(':');
  state.open[name]??=new Set();
  if(node.open) state.open[name].add(Number(row)); else state.open[name].delete(Number(row));
},true);
root.addEventListener('keydown',event=>{
  if(event.target.matches('.evidence-row label')&&['Enter',' '].includes(event.key)){event.preventDefault();document.getElementById(event.target.htmlFor)?.click();}
});
function go(step,issues=false) {
  state.step=step;state.showIssues=issues;render();
  root.querySelector('.panel h2')?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'instant'});
}
function load(data) {
  const cells=normalize(schema,{...data.cells});
  const number=cells[businessNumberField];
  if(number && businessNumberDigits(number)!==number) {
    delete cells[businessNumberField];
    msg('이전에 저장한 사업자등록번호의 형식이 올바르지 않습니다. 숫자 10자리를 다시 입력해 주세요.',true);
  }
  Object.assign(state,{id:data.id,cells,version:data.version,updated:data.updated,status:data.status,
    sentAt:data.sentAt,files:data.files,pending:{},rows:{},open:{},dirty:false,page:'editor',showIssues:false,attempted:false});
  for(const [name,g] of Object.entries(groups)) state.rows[name]=activeRows(schema,state.cells,g);
}
function create() {
  load({id:crypto.randomUUID(),cells:{},files:{},version:null,status:'draft'});
  go(0);
}
async function work(callback) {
  if(state.busy)return;
  state.busy=true;
  root.setAttribute('aria-busy','true');
  try{await callback();}catch(error){msg(error.message,true);}
  finally{state.busy=false;render();}
}
async function save(status) {
  const cells=normalize(schema,{...state.cells});
  if(status==='saved'&&checked().some(row=>row.length)){
    state.attempted=true;go(6);msg('검토 화면에서 누락 항목을 확인해 주세요.',true);return;
  }
  const result=await api(surveyPath(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    cells,version:state.version,status,files:state.pending
  })});
  Object.assign(state,{cells:result.cells,files:result.files,pending:{},status:result.status,updated:result.updated,version:result.version,dirty:false,attempted:false,showIssues:false});
  msg(status==='draft'?'임시저장했습니다.':'조사서를 저장했습니다.');
}
async function showList() {
  state.list=await api('/api/surveys');
  state.page='list';
  state.dirty=false;
  window.scrollTo(0,0);
}

async function authRequest(action,values={}) {
  await api('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
  session=await api('/api/session');
  state.dirty=false;
  state.cells={};
  state.pending={};
  state.list=[];
  state.listMode='draft';
  state.authMode='login';
  state.page='auth';
  if(session.account)await showList();
}

root.addEventListener('submit',async event=>{
  if(event.target.id!=='sales-auth')return;
  event.preventDefault();
  if(state.busy)return;
  const form=event.target, data=new FormData(form);
  state.busy=true;
  root.setAttribute('aria-busy','true');
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  try {
    await authRequest(state.authMode==='register'?'register':'login',{
      phone:data.get('phone'),pin:data.get('pin'),name:data.get('name'),keep:data.has('keep')
    });
    if(session.account)render();
  } catch(error){msg(error.message,true);}
  finally {state.busy=false;submit.disabled=false;root.setAttribute('aria-busy','false');}
});

const leave=()=>!state.dirty||window.confirm('저장하지 않은 변경 내용이 있습니다. 조사서를 닫을까요?');
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');
  if(!button||state.busy||!schema||!session)return;
  const {action,name,row,step,slot,id,mode}=button.dataset;
  if(action==='auth-mode'){state.authMode=state.authMode==='login'?'register':'login';render();return;}
  if(action==='legacy'&&session.canUseLegacy){void work(()=>authRequest('legacy'));return;}
  if(action==='logout'&&session.account){if(leave())void work(()=>authRequest('logout'));return;}
  if(!session.account)return;
  if(action==='list-mode'){state.listMode=mode;render();return;}
  if(action==='step'||action==='issue') {go(Number(step),action==='issue');return;}
  if(action==='next'||action==='back'){go(state.step+(action==='next'?1:-1));return;}
  if(action==='add'){
    const g=groups[name], rows=state.rows[name];
    const free=Array.from({length:g.end-g.start+1},(_,i)=>g.start+i).find(i=>!rows.includes(i));
    if(free!==undefined){rows.push(free);rows.sort((a,b)=>a-b);state.open[name]??=new Set();state.open[name].add(free);render();root.querySelector('[data-card="'+name+':'+free+'"] input')?.focus();}
    return;
  }
  if(action==='remove'){
    const g=groups[name], number=Number(row);
    for(const f of rowFields(schema[g.schema],g.sheet,number)) delete state.cells[f.id];
    state.rows[name]=state.rows[name].filter(r=>r!==number);state.open[name]?.delete(number);state.dirty=true;render();return;
  }
  if(action==='remove-file'){
    state.pending[slot]=null;
    const i=proofSlots.indexOf(slot); state.cells[schema.proof[i].id]=schema.proof[i].options[i===0?0:1];
    state.dirty=true;render();return;
  }
  if(action==='new'){if(leave())create();return;}
  if(action==='list'){if(leave())void work(showList);return;}
  if(action==='open'){void work(async()=>{load(await api('/api/surveys/'+id));go(state.status==='draft'?0:6);});return;}
  if(action==='draft'||action==='save'){void work(()=>save(action==='draft'?'draft':'saved'));return;}
  if(action==='send'&&session.mailReady&&!state.dirty&&window.confirm(session.recipient+'에 조사서와 증빙을 보낼까요?')){
    void work(async()=>{
      try{
        const result=await api(surveyPath()+'/send',{method:'POST'});
        state.sentAt=result.sentAt; state.status='sent';msg('이메일 발송을 완료했습니다.');
      }catch(error){
        const current=await api(surveyPath()).catch(()=>null);
        if(current){state.status=current.status;state.sentAt=current.sentAt;}
        throw error;
      }
    });
  }
});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
async function start(){
  try {
    [schema,session]=await Promise.all([api('/schema.json'),api('/api/session')]);
    if (session.account) await showList();
    render();
    navigator.serviceWorker?.register('/sw.js').catch(()=>{});
  } catch(error) {
    root.setAttribute('aria-busy','false');
    root.innerHTML='<section class="hero"><div><h1>사업장 기초조사</h1><p>'+esc(error.message)+'</p></div></section>'+
      '<a class="btn primary" href="/">다시 시도</a>';
  }
}
void start();
