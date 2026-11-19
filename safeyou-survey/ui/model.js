export const groups = {
  employees: { sheet: 4, start: 12, end: 111, title: '직원', schema: 'persons' },
  materials: { sheet: 5, start: 50, end: 57, title: '화학물질', schema: 'chemical' },
  processes: { sheet: 6, start: 8, end: 22, title: '공정', schema: 'process' }
};
export const proofSlots = ['accident', 'insurance', 'registration'];
export const fileTypes = {'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'};
export const fileLimit = 2 * 1024 * 1024;
export const steps = [
  ['사업장 기본정보','회사와 담당자 정보, 증빙 서류를 등록합니다.'],
  ['위험성평가 방식','사업장에서 사용할 평가 방식과 개선 기준을 선택합니다.'],
  ['대표·직원명부','대표자 정보와 함께 근무하는 직원 명부를 작성합니다.'],
  ['위험요인·기계·화학물질','현장에 해당하는 항목을 선택하고, 목록에 없으면 직접 입력합니다.'],
  ['주요 공정·담당자','작업 공정과 공정별 담당자, 위험성평가 참여 근로자를 등록합니다.'],
  ['안전보건 예산','연간 예산 총액을 입력하거나 항목별로 작성합니다.'],
  ['검토 및 제출','누락 항목을 확인하고 저장한 조사서를 운영사에 발송합니다.']
];
export const rowFields = (fields, sheet, row) => fields.map(field => ({...field, id: sheet + ':' + field.col + row}));
export const present = value => typeof value === 'string' && value.trim() !== '';
export const activeRows = (schema, cells, group) => {
  const rows = [];
  for (let row = group.start; row <= group.end; row++) {
    if (rowFields(schema[group.schema], group.sheet, row).some(f => present(cells[f.id]))) rows.push(row);
  }
  return rows;
};

export function allFields(schema) {
  const fields = [
    ...schema.basic,...schema.contact,...schema.proof,...schema.methods,...schema.levels,
    schema.same,...schema.risks,...schema.equipment,...schema.equipmentExtra,...schema.chemicals,
    ...schema.chemicalExtra,schema.confirmation,schema.year,schema.budgetMode,schema.budgetTotal,
    ...schema.review,...rowFields(schema.persons,4,7)
  ];
  for (const group of Object.values(groups)) {
    for (let row=group.start; row<=group.end; row++) fields.push(...rowFields(schema[group.schema],group.sheet,row));
  }
  for (let row=13; row<=22; row++) fields.push(...rowFields(schema.budget,7,row));
  return new Map(fields.map(f => [f.id,f]));
}

export const businessNumberField = '2:C8';
export const businessNumberLimit = 10;
export const businessNumberDigits = value => value.replace(/\D/g,'').slice(0,businessNumberLimit);

export function fieldError(field, value) {
  if (!present(value)) return '입력해 주세요.';
  if (field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '이메일 형식을 확인해 주세요.';
  if (field.kind === 'tel' && (!/^[+\d() -]+$/.test(value) || value.replace(/\D/g,'').length < 8 || value.replace(/\D/g,'').length > 15)) return '연락처 형식을 확인해 주세요.';
  if (field.kind === 'business' && (!/^\d{10}$/.test(value))) return '사업자등록번호 10자리를 확인해 주세요.';
  if (field.kind === 'number' && (!/^\d+$/.test(value) || Number(value) < (field.min ?? 0) || !Number.isSafeInteger(Number(value)) || Number(value)>999999999999999)) return '유효한 숫자를 입력해 주세요.';
  if (field.kind === 'date') {
    const date = new Date(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return '날짜를 확인해 주세요.';
  }
  if (field.kind === 'select' && !field.options.includes(value)) return '목록에서 선택해 주세요.';
  if (field.kind === 'check' && value !== '●') return '선택을 확인해 주세요.';
  return '';
}

const surveyDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const filenameEncoder = new TextEncoder();

function filenamePart(value, fallback) {
  const safe = (value ?? '').toWellFormed().trim().replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g,'_');
  let part = '', bytes = 0;
  for (const character of safe) {
    bytes += filenameEncoder.encode(character).length;
    if (bytes > 110) break;
    part += character;
  }
  return part.trim().replace(/[. ]+$/,'') || fallback;
}

export function surveyFileTitle(cells, updated) {
  const enteredDate = cells['8:C26'];
  let date = enteredDate;
  if (fieldError({kind:'date'},enteredDate)) {
    const parts = Object.fromEntries(surveyDate.formatToParts(new Date(updated)).map(({type,value})=>[type,value]));
    date = parts.year+'-'+parts.month+'-'+parts.day;
  }
  const company = filenamePart(cells['2:C6'],'사업장 미입력');
  const affiliation = filenamePart(cells['8:C23'],'소속 미입력');
  return date+'_'+company+'_'+affiliation;
}

export function budgetAmount(schema, cells) {
  if (cells['7:D6'] === schema.budgetMode.options[1]) return Number(cells['7:D9'] || 0);
  return schema.budgetKinds.reduce((total, name, i) => total + Number(cells['7:E' + (i + 13)] || 0), 0);
}

export function normalize(schema, cells) {
  const number = cells[businessNumberField];
  if (/^\d{3}-\d{2}-\d{5}$/.test(number ?? '')) cells[businessNumberField]=businessNumberDigits(number);
  if (cells['4:F4'] === '예') {
    for (const [target,source] of Object.entries({'4:C7':'2:C19','4:D7':'2:C22','4:E7':'2:C21','4:F7':'2:C20'})) {
      if (present(cells[source])) cells[target] = cells[source]; else delete cells[target];
    }
  }
  if (cells['3:C7'] !== '●') {
    delete cells['3:C13']; delete cells['3:C14'];
  } else if (!cells['3:C14']) cells['3:C13']='●';
  return cells;
}

export function validate(schema, cells, files = {}) {
  const rows = Array.from({length:7}, () => []);
  const insert = (i, label, message, field) => rows[i].push({label,message,field});
  const check = (i, field, label=field.label) => {
    const value = cells[field.id];
    if (field.required || present(value)) {
      const error = fieldError(field,value);
      if (error) insert(i,label,error,field.id);
    }
  };
  for (const f of [...schema.basic,...schema.contact,...schema.proof]) check(0,f);
  if (cells['2:C26'] === schema.proof[0].options[1] && !files.accident) insert(0,'무재해 증빙','증빙 파일을 첨부해 주세요.');
  for (const [i,slot] of proofSlots.entries()) {
    if (i && cells[schema.proof[i].id] === schema.proof[i].options[0] && !files[slot]) insert(0,schema.proof[i].label,'첨부로 표시한 파일을 등록해 주세요.');
  }
  if (schema.methods.filter(f => cells[f.id] === '●').length !== 1) insert(1,'평가 방법','평가 방법을 1개 선택해 주세요.');
  check(2,schema.same);
  for (const f of rowFields(schema.persons,4,7)) if (f.col !== 'G') check(2,{...f,required:['C','D'].includes(f.col)});
  const employees = activeRows(schema,cells,groups.employees);
  for (const row of employees) for (const f of rowFields(schema.persons,4,row)) check(2,f,'직원 '+(row-11)+' '+f.label);
  if (Number(cells['2:C13']) > 1 && !employees.length) insert(2,'직원명부','직원을 한 명 이상 추가해 주세요.');
  if (!cells['5:I63']) insert(3,'사업장 위험요인 확인','현장 정보 확인란에 체크해 주세요.','5:I63');
  for (const row of activeRows(schema,cells,groups.materials)) for (const f of rowFields(schema.chemical,5,row)) check(3,f);
  const processes = activeRows(schema,cells,groups.processes);
  if (!processes.length) insert(4,'주요 공정','공정을 한 개 이상 추가해 주세요.');
  for (const row of processes) {
    for (const f of rowFields(schema.process,6,row)) check(4,f,'공정 '+(row-7)+' '+f.label);
    if (!['I','J','K'].some(c => present(cells['6:'+c+row]))) insert(4,'공정 '+(row-7)+' 참여 근로자','참여 근로자를 한 명 이상 입력해 주세요.','6:I'+row);
  }
  check(5,schema.year);
  check(5,schema.budgetMode);
  if (cells['7:D6'] === schema.budgetMode.options[1]) check(5,schema.budgetTotal);
  if (cells['7:D6'] === schema.budgetMode.options[0]) {
    if (!schema.budgetKinds.some((_,i)=>present(cells['7:E'+(i+13)]))) insert(5,'항목별 예산','금액을 한 항목 이상 입력해 주세요.');
    schema.budgetKinds.forEach((n,i)=>rowFields(schema.budget,7,13+i).forEach(f=>check(5,f,n+' '+f.label)));
  }
  for (const f of schema.review) check(6,f);
  return rows;
}
