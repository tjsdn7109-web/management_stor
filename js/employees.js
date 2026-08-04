// employees.js — 직원 관리 (데이터 로직 + 폼 렌더링)

import { State } from './state.js';
import { DAY_NAMES_KO, esc } from './holidays.js';

// ── 직원 색상 팔레트 ───────────────────────────
const COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
  '#14B8A6','#F43F5E','#A855F7','#0EA5E9','#22C55E',
];

export function getNextColor() {
  const used = new Set(State.employees.map(e => e.color));
  return COLORS.find(c => !used.has(c)) || COLORS[State.employees.length % COLORS.length];
}

/** 팔레트 목록 (색상 선택 UI에서 사용) */
export function getPalette() {
  return [...COLORS];
}

/** 해당 색을 이미 쓰고 있는 다른 직원 반환 (없으면 null) */
export function findColorOwner(color, exceptId = null) {
  const norm = (color || '').toLowerCase();
  return State.employees.find(e => e.id !== exceptId && (e.color || '').toLowerCase() === norm) || null;
}

// ── 고용형태별 급여 필드 메타 ─────────────────
const WAGE_META = {
  hourly:    { label: '시급 (원)',  placeholder: '시급을 입력해주세요',    defaultVal: 10030 },
  monthly:   { label: '월급 (원)',  placeholder: '월 급여를 입력해주세요', defaultVal: 2500000 },
  shortTerm: { label: '시급 (원)',  placeholder: '시급을 입력해주세요',    defaultVal: 10030 },
};

// ── 직급이 관리자인지 확인 ───────────────────
export function isAdminPosition(positionName) {
  const positions = State.settings.positions || [];
  const found = positions.find(p => p.name === positionName);
  return found ? found.isAdmin : false;
}

/**
 * 직급 서열 — 설정의 직급 목록 순서가 곧 서열 (위쪽일수록 높음)
 * 목록에 없는 직급은 맨 뒤로.
 */
export function positionRank(positionName) {
  const positions = State.settings.positions || [];
  const idx = positions.findIndex(p => p.name === positionName);
  return idx === -1 ? 9999 : idx;
}

/** 직급 높은 순 → 같으면 이름순 정렬 비교자 */
export function compareByRank(a, b) {
  const ra = positionRank(a.position);
  const rb = positionRank(b.position);
  if (ra !== rb) return ra - rb;
  return (a.name || '').localeCompare(b.name || '', 'ko');
}

/**
 * 실효 주 최대 근무일 = min(최대 근무일, 7 − 최소 휴무일)
 * 두 설정이 모순될 때 더 엄격한 쪽을 따른다.
 */
export function effectiveMaxWorkDays(emp) {
  const byMax  = emp.maxWorkDaysPerWeek || 6;
  const byRest = 7 - (emp.minRestDaysPerWeek ?? 1);
  return Math.max(1, Math.min(byMax, byRest));
}

// ── 직원 데이터 생성 ───────────────────────────
export function createEmployee(fields) {
  const id    = State.generateId('emp');
  const color = getNextColor();
  const type  = fields.employmentType || 'hourly';

  return {
    id,
    name: fields.name || '',
    gender: fields.gender || 'M',
    position: fields.position || '직원',
    employmentType: type,
    hourlyWage:  type !== 'monthly' ? (Number(fields.hourlyWage)  || 10030)   : 0,
    monthlyWage: type === 'monthly' ? (Number(fields.monthlyWage) || 2500000) : 0,
    maxWorkDaysPerWeek: Number(fields.maxWorkDaysPerWeek) || 6,
    targetWorkDaysPerWeek: Number(fields.targetWorkDaysPerWeek) || Number(fields.maxWorkDaysPerWeek) || 5,
    minRestDaysPerWeek: Number(fields.minRestDaysPerWeek) ?? 1,
    maxConsecutiveDays: Number(fields.maxConsecutiveDays) || 5,
    dailyWorkHours: Number(fields.dailyWorkHours) || 8,
    availableWorkDays: fields.availableWorkDays || [1,2,3,4,5],
    preferredDates:  [],
    holidayRequests: [],
    notes: fields.notes || '',
    color,
  };
}

// ── 직원 폼 HTML 렌더링 ────────────────────────
export function renderEmployeeForm(index, total, existing = null) {
  const e      = existing || {};
  const type   = e.employmentType || 'hourly';
  const meta   = WAGE_META[type] || WAGE_META.hourly;
  const wageVal = type === 'monthly'
    ? (e.monthlyWage || meta.defaultVal)
    : (e.hourlyWage  || meta.defaultVal);

  const availDays = e.availableWorkDays || [1,2,3,4,5];
  const dayCheckboxes = DAY_NAMES_KO.map((name, i) => {
    const checked = availDays.includes(i) ? 'checked' : '';
    return `<label class="day-checkbox ${checked ? 'active' : ''}" data-day="${i}">
      <input type="checkbox" value="${i}" ${checked}> ${name}
    </label>`;
  }).join('');

  // 직급 옵션: State.settings.positions에서 동적으로
  const positions = State.settings.positions || [
    { name: '사장', isAdmin: true }, { name: '매니저', isAdmin: true },
    { name: '정직원', isAdmin: false }, { name: '아르바이트', isAdmin: false }, { name: '기타', isAdmin: false },
  ];
  const posOptions = positions.map(p =>
    `<option value="${esc(p.name)}" ${e.position === p.name ? 'selected' : ''}>${esc(p.name)}${p.isAdmin ? ' ★' : ''}</option>`
  ).join('');

  const empTypes = [
    { value: 'hourly',    label: '시급제' },
    { value: 'monthly',   label: '월급제' },
    { value: 'shortTerm', label: '단기'   },
  ];
  const typeOptions = empTypes.map(t =>
    `<option value="${t.value}" ${type === t.value ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  return `
<div class="employee-form">
  <div class="form-header">
    <span class="form-step">${index} / ${total}</span>
    <h2 class="form-title">${existing ? '직원 정보 수정' : `${index}번째 직원 정보 입력`}</h2>
  </div>

  <form id="employee-form-${index}" class="form-grid" novalidate>
    <input type="hidden" name="id" value="${e.id || ''}">

    <div class="form-group">
      <label>이름 <span class="required">*</span></label>
      <input type="text" name="name" value="${esc(e.name || '')}" placeholder="홍길동" required>
    </div>

    <div class="form-group">
      <label>성별</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" name="gender" value="M" ${(e.gender || 'M') === 'M' ? 'checked' : ''}> 남
        </label>
        <label class="radio-label">
          <input type="radio" name="gender" value="F" ${e.gender === 'F' ? 'checked' : ''}> 여
        </label>
      </div>
    </div>

    <div class="form-group">
      <label>직급</label>
      <select name="position" id="position-select-${index}">
        ${posOptions}
      </select>
    </div>

    <div class="form-group">
      <label>고용 형태</label>
      <select name="employmentType" id="emp-type-select-${index}">
        ${typeOptions}
      </select>
    </div>

    <div class="form-group" id="wage-group-${index}">
      <label id="wage-label-${index}">${meta.label}</label>
      <input type="number" name="wageAmount" id="wage-input-${index}"
             value="${wageVal}" min="0" step="10"
             placeholder="${meta.placeholder}">
    </div>

    <div class="form-group">
      <label>최대 주 근무일 <small>(사장은 최대 7일)</small></label>
      <input type="number" name="maxWorkDaysPerWeek" value="${e.maxWorkDaysPerWeek || 6}"
        min="1" max="7" id="max-days-${index}">
    </div>

    <div class="form-group">
      <label>희망 주 근무일 <small>(자동 배정 기준)</small></label>
      <input type="number" name="targetWorkDaysPerWeek"
             value="${e.targetWorkDaysPerWeek || e.maxWorkDaysPerWeek || 5}"
             min="1" max="7" id="target-days-${index}">
    </div>

    <div class="form-group">
      <label>주 최소 휴무일</label>
      <input type="number" name="minRestDaysPerWeek"
             value="${e.minRestDaysPerWeek ?? 1}" min="0" max="6"
             id="min-rest-${index}">
      <small class="field-hint" id="rest-hint-${index}"></small>
    </div>

    <div class="form-group">
      <label>연속근무 상한 <small>(연달아 근무 가능한 일수)</small></label>
      <input type="number" name="maxConsecutiveDays"
             value="${e.maxConsecutiveDays || 5}" min="1" max="14"
             id="max-consec-${index}">
    </div>

    <div class="form-group">
      <label>하루 근무시간 (시간)</label>
      <input type="number" name="dailyWorkHours" value="${e.dailyWorkHours || 8}"
             min="1" max="24" step="0.5">
    </div>

    <div class="form-group full-width">
      <label>근무 가능 요일</label>
      <div class="day-checkboxes" id="day-checkboxes-${index}">
        ${dayCheckboxes}
      </div>
    </div>

    <div class="form-group full-width">
      <label>메모</label>
      <textarea name="notes" rows="2" style="width:100%;resize:vertical;font-family:inherit;font-size:.9rem;padding:8px;border:1px solid var(--gray-200);border-radius:var(--radius);" placeholder="특이사항, 연락처 등">${esc(e.notes || '')}</textarea>
    </div>

    <div class="form-actions full-width">
      ${existing ? `<button type="button" class="btn btn-danger" data-action="delete-employee" data-id="${e.id}">삭제</button>` : ''}
      <button type="submit" class="btn btn-primary">
        ${existing ? '저장' : (index < total ? '다음 직원 →' : '완료')}
      </button>
    </div>
  </form>
</div>`;
}

// ── 직원 카드 목록 렌더링 ──────────────────────
export function renderEmployeeList(container) {
  if (!State.employees.length) {
    container.innerHTML = `<div class="empty-state">
      <p>등록된 직원이 없습니다.</p>
      <button class="btn btn-primary" data-action="add-employee">직원 추가</button>
    </div>`;
    return;
  }

  const cards = State.employees.slice().sort(compareByRank).map(emp => {
    const dayNames = [...emp.availableWorkDays]
      .sort((a, b) => a - b)
      .map(d => DAY_NAMES_KO[d])
      .join(', ');
    const empTypeMap = { hourly: '시급제', monthly: '월급제', shortTerm: '단기' };
    const wageDisplay = emp.employmentType === 'monthly'
      ? `월급 ${(emp.monthlyWage || 0).toLocaleString()}원`
      : `시급 ${(emp.hourlyWage  || 0).toLocaleString()}원`;

    const admin = isAdminPosition(emp.position);

    return `
<div class="employee-card" data-id="${emp.id}">
  <button class="emp-color-dot" data-action="edit-color" data-id="${emp.id}"
          style="background:${esc(emp.color)}" title="색상 변경">
    <span class="emp-color-pencil">✎</span>
  </button>
  <div class="emp-card-body">
    <div class="emp-card-header">
      <span class="emp-name">${esc(emp.name)}</span>
      <span class="emp-badge">${esc(emp.position)}</span>
      ${admin ? '<span class="emp-badge admin-badge">관리자</span>' : ''}
      <span class="emp-badge secondary">${empTypeMap[emp.employmentType] || emp.employmentType}</span>
    </div>
    <div class="emp-card-details">
      <span>${wageDisplay}</span>
      <span>일 ${emp.dailyWorkHours}시간</span>
      <span>주 최대 ${emp.maxWorkDaysPerWeek}일 / 희망 ${emp.targetWorkDaysPerWeek || emp.maxWorkDaysPerWeek}일</span>
      <span>주 휴무 ${emp.minRestDaysPerWeek ?? 1}일 · 연속 최대 ${emp.maxConsecutiveDays || 5}일</span>
      <span>근무가능: ${dayNames}</span>
    </div>
  </div>
  <div class="emp-card-actions">
    <button class="btn btn-sm" data-action="edit-employee" data-id="${emp.id}">편집</button>
    <button class="btn btn-sm" data-action="employee-preferred" data-id="${emp.id}">고정 근무일</button>
    <button class="btn btn-sm" data-action="employee-holiday" data-id="${emp.id}">휴무 신청</button>
    <button class="btn btn-sm btn-ghost notes-toggle-btn" data-action="toggle-notes" data-id="${emp.id}">메모 ▾</button>
  </div>
  <div class="emp-notes-section" id="notes-section-${emp.id}">
    <div class="emp-notes-inner">
      <textarea class="emp-notes-input" id="notes-input-${emp.id}"
                placeholder="특이사항, 연락처 등">${esc(emp.notes || '')}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn btn-sm btn-outline" data-action="save-notes" data-id="${emp.id}">저장</button>
      </div>
    </div>
  </div>
</div>`;
  }).join('');

  container.innerHTML = `
<div class="section-header">
  <h2>직원 관리</h2>
  <button class="btn btn-primary" data-action="add-employee">+ 직원 추가</button>
</div>
<div class="employee-list">${cards}</div>`;
}

// ── 직원 폼 데이터 파싱 ────────────────────────
export function parseEmployeeForm(form) {
  const data = new FormData(form);
  const name = (data.get('name') || '').trim();
  if (!name) {
    showFormError(form, '이름을 입력해 주세요.');
    return null;
  }

  const checkedDays = [...form.querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => parseInt(cb.value))
    .filter(v => !isNaN(v));

  if (!checkedDays.length) {
    showFormError(form, '근무 가능 요일을 하나 이상 선택해 주세요.');
    return null;
  }

  const position       = data.get('position') || '직원';
  const employmentType = data.get('employmentType') || 'hourly';
  const wageAmount     = parseFloat(data.get('wageAmount')) || 0;
  const maxDays        = parseInt(data.get('maxWorkDaysPerWeek')) || 6;
  const isBoss         = isAdminPosition(position);
  const maxAllowed     = isBoss ? 7 : 6;

  return {
    name,
    gender: data.get('gender') || 'M',
    position,
    employmentType,
    hourlyWage:  employmentType !== 'monthly' ? wageAmount : 0,
    monthlyWage: employmentType === 'monthly' ? wageAmount : 0,
    maxWorkDaysPerWeek: Math.min(maxDays, maxAllowed),
    targetWorkDaysPerWeek: Math.min(parseInt(data.get('targetWorkDaysPerWeek')) || maxDays, maxAllowed),
    minRestDaysPerWeek: Math.max(0, Math.min(parseInt(data.get('minRestDaysPerWeek')) ?? 1, 6)),
    maxConsecutiveDays: Math.max(1, Math.min(parseInt(data.get('maxConsecutiveDays')) || 5, 14)),
    dailyWorkHours: parseFloat(data.get('dailyWorkHours')) || 8,
    availableWorkDays: checkedDays,
    notes: (data.get('notes') || '').trim(),
  };
}

function showFormError(form, msg) {
  let err = form.querySelector('.form-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'form-error';
    form.prepend(err);
  }
  err.textContent = msg;
  err.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── 직급 변경 시 최대 근무일 자동 조정 ──────────
export function bindPositionWatcher(formEl, index) {
  const posSelect    = formEl.querySelector(`#position-select-${index}`);
  const maxDaysInput = formEl.querySelector(`#max-days-${index}`);
  const tgtDaysInput = formEl.querySelector(`#target-days-${index}`);
  const restInput    = formEl.querySelector(`#min-rest-${index}`);
  const restHint     = formEl.querySelector(`#rest-hint-${index}`);
  if (!posSelect || !maxDaysInput) return;

  const syncHint = () => {
    if (!restHint) return;
    const rest = parseInt(restInput?.value ?? 1) || 0;
    const max  = parseInt(maxDaysInput.value) || 6;
    const eff  = Math.max(1, Math.min(max, 7 - rest));
    restHint.textContent = `→ 실제 주 최대 ${eff}일 근무`;
    restHint.classList.toggle('hint-warn', eff < max);
  };

  posSelect.addEventListener('change', () => {
    const isBoss = isAdminPosition(posSelect.value);
    maxDaysInput.max = isBoss ? 7 : 6;
    if (!isBoss && parseInt(maxDaysInput.value) > 6) maxDaysInput.value = 6;
    if (tgtDaysInput) {
      tgtDaysInput.max = isBoss ? 7 : 6;
      if (!isBoss && parseInt(tgtDaysInput.value) > 6) tgtDaysInput.value = 6;
    }
    // 관리자를 주 7일로 두면 휴무 0일이 되어야 모순이 없음
    if (isBoss && parseInt(maxDaysInput.value) === 7 && restInput) restInput.value = 0;
    syncHint();
  });

  restInput?.addEventListener('input', syncHint);
  maxDaysInput.addEventListener('input', syncHint);
  syncHint();
}

// ── 고용형태 변경 시 급여 필드 동적 변경 ─────────
export function bindEmploymentTypeWatcher(formEl, index) {
  const typeSelect = formEl.querySelector(`#emp-type-select-${index}`);
  const wageLabel  = formEl.querySelector(`#wage-label-${index}`);
  const wageInput  = formEl.querySelector(`#wage-input-${index}`);
  if (!typeSelect || !wageLabel || !wageInput) return;

  typeSelect.addEventListener('change', () => {
    const meta = WAGE_META[typeSelect.value] || WAGE_META.hourly;
    wageLabel.textContent = meta.label;
    wageInput.placeholder = meta.placeholder;
    if (!wageInput.value || wageInput.value === '0') {
      wageInput.value = meta.defaultVal;
    }
  });
}

// ── 근무 가능 요일 체크박스 스타일 바인딩 ───────
export function bindDayCheckboxes(formEl, index) {
  const container = formEl.querySelector(`#day-checkboxes-${index}`);
  if (!container) return;
  container.addEventListener('change', e => {
    if (e.target.type === 'checkbox') {
      e.target.closest('label').classList.toggle('active', e.target.checked);
    }
  });
}
