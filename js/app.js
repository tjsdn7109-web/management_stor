// app.js — 메인 컨트롤러 & 라우팅

import { State } from './state.js';
import {
  renderEmployeeForm, renderEmployeeList,
  createEmployee, parseEmployeeForm,
  bindPositionWatcher, bindDayCheckboxes, bindEmploymentTypeWatcher,
  getPalette, findColorOwner,
} from './employees.js';
import { renderCalendar, showToast } from './calendar.js';
import { esc } from './holidays.js';
import { renderScheduleTab } from './scheduleUI.js';
import { renderSalaryTab } from './salaryCalculator.js';

// ══════════════════════════════════════════════════════
// 초기화
// ══════════════════════════════════════════════════════
function init() {
  State.load();
  renderApp();
  if (State.employees.length > 0) {
    switchView('main');
  } else {
    switchView('welcome');
  }
}

// ══════════════════════════════════════════════════════
// 앱 셸 렌더링
// ══════════════════════════════════════════════════════
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
<header class="app-header hidden" id="app-header">
  <span class="app-logo">📋 근무 관리</span>
  <nav class="app-nav" id="app-nav">
    <button class="nav-tab active" data-tab="employees">직원 관리</button>
    <button class="nav-tab" data-tab="schedule">스케줄</button>
    <button class="nav-tab" data-tab="salary">급여 계산</button>
    <button class="nav-tab" data-tab="settings">⚙ 설정</button>
  </nav>
</header>

<main class="main-content" id="main-content"></main>
<div id="toast-container"></div>`;

  bindGlobalEvents();
}

// ══════════════════════════════════════════════════════
// 뷰 전환
// ══════════════════════════════════════════════════════
function switchView(view) {
  State.ui.currentView = view;
  const header  = document.getElementById('app-header');
  const content = document.getElementById('main-content');

  if (view === 'main') {
    header.classList.remove('hidden');
    switchTab(State.ui.currentTab);
  } else if (view === 'welcome') {
    header.classList.add('hidden');
    renderWelcome(content);
  } else if (view === 'setup') {
    header.classList.add('hidden');
    renderSetup(content);
  }
}

// ── 탭 전환 ───────────────────────────────────
function switchTab(tab) {
  // 탭이 존재하지 않으면 employees로 폴백
  const validTabs = ['employees','schedule','salary','settings'];
  if (!validTabs.includes(tab)) tab = 'employees';
  State.ui.currentTab = tab;

  const content = document.getElementById('main-content');
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
    // 스케줄 탭에 확인 대기 배지 표시
    if (btn.dataset.tab === 'schedule') {
      const pending = State.ui.pendingEmployeeChanges?.length || 0;
      btn.classList.toggle('nav-pending', pending > 0 && tab !== 'schedule');
    }
  });

  if      (tab === 'employees') renderEmployeesTab(content);
  else if (tab === 'schedule')  renderScheduleTab(content);
  else if (tab === 'salary')    renderSalaryTab(content);
  else if (tab === 'settings')  renderSettingsTab(content);
}

// ══════════════════════════════════════════════════════
// 환영 화면
// ══════════════════════════════════════════════════════
function renderWelcome(container) {
  container.innerHTML = `
<div class="welcome-screen">
  <h1>근무 스케줄 & 급여 관리</h1>
  <p>직원 스케줄을 자동으로 생성하고 급여를 계산합니다.</p>

  <div class="store-count-input">
    <label for="employee-count" style="font-weight:600">몇 인 규모의 사업장이신가요?</label>
    <input type="number" id="employee-count" min="1" max="50" value="3" placeholder="인원수">
    <span>명</span>
    <button class="btn btn-primary" id="start-setup">시작하기 →</button>
  </div>

  ${State.employees.length ? `
  <p style="color:var(--gray-400);font-size:.85rem">또는</p>
  <button class="btn btn-outline" id="go-main">저장된 데이터로 계속하기 (${State.employees.length}명)</button>
  ` : ''}
</div>`;

  document.getElementById('start-setup').addEventListener('click', () => {
    const count = parseInt(document.getElementById('employee-count').value);
    if (!count || count < 1) { showToast('인원수를 입력해 주세요.', 'error'); return; }
    State.ui.totalEmployeeCount = count;
    State.ui.setupEmployeeIndex = 0;
    switchView('setup');
  });

  document.getElementById('go-main')?.addEventListener('click', () => {
    switchView('main');
  });
}

// ══════════════════════════════════════════════════════
// 직원 설정 마법사
// ══════════════════════════════════════════════════════
function renderSetup(container) {
  const idx   = State.ui.setupEmployeeIndex;
  const total = State.ui.totalEmployeeCount;
  const displayIndex = idx + 1;

  container.innerHTML = `
<div class="setup-screen">
  ${renderEmployeeForm(displayIndex, total)}
</div>`;

  const form = container.querySelector(`#employee-form-${displayIndex}`);
  if (form) {
    bindPositionWatcher(form, displayIndex);
    bindDayCheckboxes(form, displayIndex);
    bindEmploymentTypeWatcher(form, displayIndex);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = parseEmployeeForm(form);
      if (!data) return;
      State.addEmployee(createEmployee(data));
      const nextIdx = idx + 1;
      if (nextIdx < total) {
        State.ui.setupEmployeeIndex = nextIdx;
        renderSetup(container);
      } else {
        State.ui.setupEmployeeIndex = 0;
        showToast(`${total}명의 직원이 등록되었습니다.`);
        switchView('main');
      }
    });
  }
}

// ══════════════════════════════════════════════════════
// 직원 관리 탭
// ══════════════════════════════════════════════════════
function renderEmployeesTab(container) {
  renderEmployeeList(container);

  if (container._empHandler) container.removeEventListener('click', container._empHandler);
  container._empHandler = e => {
    const action = e.target.dataset.action;
    const id     = e.target.dataset.id;

    if      (action === 'add-employee')       openEmployeeDrawer(container, null);
    else if (action === 'edit-employee')      openEmployeeDrawer(container, id);
    else if (action === 'delete-employee')    deleteEmployee(container, id);
    else if (action === 'employee-holiday')   openCalendarDrawer(container, id, 'holiday');
    else if (action === 'employee-preferred') openCalendarDrawer(container, id, 'preferred');
    else if (action === 'toggle-notes')       _toggleNotes(id);
    else if (action === 'save-notes')         _saveNotes(id);
    else if (action === 'edit-color')         _openColorPicker(container, id);
  };
  container.addEventListener('click', container._empHandler);
}

// ── 색상 선택 모달 ────────────────────────────
function _openColorPicker(tabContainer, empId) {
  const emp = State.getEmployee(empId);
  if (!emp) return;

  document.getElementById('color-picker-modal')?.remove();

  const palette = getPalette();
  const usedMap = {};
  State.employees.forEach(e => {
    if (e.id !== empId) usedMap[(e.color || '').toLowerCase()] = e.name;
  });

  const swatches = palette.map(c => {
    const owner = usedMap[c.toLowerCase()];
    const isCur = (emp.color || '').toLowerCase() === c.toLowerCase();
    return `<button class="color-swatch${isCur ? ' swatch-current' : ''}${owner ? ' swatch-used' : ''}"
                    data-color="${c}" style="background:${c}"
                    title="${owner ? `${owner}님이 사용 중` : c}">
      ${isCur ? '<span class="swatch-check">✓</span>' : ''}
      ${owner ? `<span class="swatch-owner">${esc(owner.slice(0, 2))}</span>` : ''}
    </button>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'color-picker-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box">
  <div class="modal-header">
    <h3 class="modal-title">색상 변경</h3>
    <span class="modal-date-label">${esc(emp.name)}</span>
  </div>

  <div class="color-preview-row">
    <span class="color-preview-dot" id="color-preview" style="background:${esc(emp.color)}"></span>
    <span class="color-preview-tag" id="color-tag-preview" style="background:${esc(emp.color)}">
      ${esc(emp.name)}
    </span>
    <span class="color-preview-note">스케줄에 표시되는 모습</span>
  </div>

  <div class="color-palette">${swatches}</div>

  <div class="color-custom-row">
    <label for="custom-color">직접 지정</label>
    <input type="color" id="custom-color" value="${esc(emp.color || '#3B82F6')}">
    <input type="text" id="custom-hex" value="${esc(emp.color || '#3B82F6')}" maxlength="7" spellcheck="false">
  </div>

  <p class="color-warn" id="color-warn"></p>

  <div class="modal-actions">
    <button class="btn btn-ghost" id="color-cancel">취소</button>
    <button class="btn btn-primary" id="color-save">저장</button>
  </div>
</div>`;

  document.body.appendChild(modal);

  let selected = emp.color || '#3B82F6';

  const dot     = modal.querySelector('#color-preview');
  const tagPrev = modal.querySelector('#color-tag-preview');
  const picker  = modal.querySelector('#custom-color');
  const hexIn   = modal.querySelector('#custom-hex');
  const warnEl  = modal.querySelector('#color-warn');

  const apply = val => {
    if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
    selected = val;
    dot.style.background     = val;
    tagPrev.style.background = val;
    picker.value = val;
    hexIn.value  = val;

    modal.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('swatch-current', s.dataset.color.toLowerCase() === val.toLowerCase());
    });

    const owner = findColorOwner(val, empId);
    warnEl.textContent = owner ? `⚠ ${owner.name}님이 이미 사용 중인 색입니다. 구분이 어려울 수 있습니다.` : '';
    warnEl.classList.toggle('visible', !!owner);
  };
  apply(selected);

  modal.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => apply(s.dataset.color));
  });
  picker.addEventListener('input', () => apply(picker.value));
  hexIn.addEventListener('input', () => {
    let v = hexIn.value.trim();
    if (v && !v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) apply(v);
  });

  const close = () => modal.remove();
  modal.querySelector('#color-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelector('#color-save').addEventListener('click', () => {
    State.updateEmployee(empId, { color: selected });
    showToast(`${emp.name}님의 색상이 변경되었습니다.`);
    close();
    renderEmployeesTab(tabContainer);
  });
}

// ── 메모 토글 / 저장 ──────────────────────────
function _toggleNotes(empId) {
  const section = document.getElementById(`notes-section-${empId}`);
  if (!section) return;

  const willOpen = !section.classList.contains('notes-open');
  section.classList.toggle('notes-open', willOpen);

  // 실제 내용 높이만큼 펼쳐지도록 max-height 설정 (부드러운 슬라이드)
  const inner = section.querySelector('.emp-notes-inner');
  section.style.maxHeight = willOpen && inner ? `${inner.scrollHeight + 20}px` : '0px';

  const btn = document.querySelector(`[data-action="toggle-notes"][data-id="${empId}"]`);
  if (btn) {
    btn.textContent = willOpen ? '메모 ▴' : '메모 ▾';
    btn.classList.toggle('notes-active', willOpen);
  }

  if (willOpen) {
    setTimeout(() => section.querySelector('.emp-notes-input')?.focus(), 220);
  }
}

function _saveNotes(empId) {
  const textarea = document.getElementById(`notes-input-${empId}`);
  if (!textarea) return;
  State.updateEmployee(empId, { notes: textarea.value.trim() });
  showToast('메모가 저장되었습니다.');
}

// ── 직원 추가/편집 드로어 ─────────────────────
function openEmployeeDrawer(tabContainer, employeeId) {
  const existing = employeeId ? State.getEmployee(employeeId) : null;
  const isEdit   = !!existing;
  const formIdx  = Date.now();

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';

  drawer.innerHTML = `
<div class="drawer-header">
  <h2>${isEdit ? '직원 정보 수정' : '직원 추가'}</h2>
  <button class="drawer-close" data-action="close-drawer">✕</button>
</div>
${renderEmployeeForm(formIdx, formIdx, existing)}`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const form = drawer.querySelector(`#employee-form-${formIdx}`);
  bindPositionWatcher(form, formIdx);
  bindDayCheckboxes(form, formIdx);
  bindEmploymentTypeWatcher(form, formIdx);

  const closeDrawer = () => { overlay.remove(); drawer.remove(); };
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelector('[data-action="close-drawer"]').addEventListener('click', closeDrawer);
  drawer.querySelector('[data-action="delete-employee"]')?.addEventListener('click', () => {
    deleteEmployee(tabContainer, employeeId, closeDrawer);
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = parseEmployeeForm(form);
    if (!data) return;

    if (isEdit) {
      const before = { ...State.getEmployee(employeeId) };
      State.updateEmployee(employeeId, data);
      const diffs = _diffScheduleRelevant(before, State.getEmployee(employeeId));
      if (diffs.length) {
        _recordPendingChange(employeeId, data.name, diffs);
        showToast(`${data.name}님의 정보가 수정되었습니다. 스케줄 확인이 필요합니다.`, 'warn', 4000);
      } else {
        showToast(`${data.name}님의 정보가 수정되었습니다.`);
      }
    } else {
      State.addEmployee(createEmployee(data));
      showToast(`${data.name}님이 추가되었습니다.`);
    }
    closeDrawer();
    renderEmployeesTab(tabContainer);
  });
}

// ── 스케줄에 영향을 주는 필드 변경 감지 ─────────
const DAY_KO = ['일','월','화','수','목','금','토'];

function _diffScheduleRelevant(before, after) {
  if (!before || !after) return [];
  const diffs = [];

  const push = (label, from, to) => diffs.push({ label, from: String(from), to: String(to) });

  if (before.name !== after.name) push('이름', before.name, after.name);

  const bDays = [...(before.availableWorkDays || [])].sort().join(',');
  const aDays = [...(after.availableWorkDays  || [])].sort().join(',');
  if (bDays !== aDays) {
    push('근무 가능요일',
      (before.availableWorkDays || []).sort().map(d => DAY_KO[d]).join('·') || '없음',
      (after.availableWorkDays  || []).sort().map(d => DAY_KO[d]).join('·') || '없음');
  }

  if ((before.maxWorkDaysPerWeek || 0) !== (after.maxWorkDaysPerWeek || 0))
    push('주 최대 근무일', `${before.maxWorkDaysPerWeek}일`, `${after.maxWorkDaysPerWeek}일`);

  if ((before.minRestDaysPerWeek ?? 1) !== (after.minRestDaysPerWeek ?? 1))
    push('주 최소 휴무일', `${before.minRestDaysPerWeek ?? 1}일`, `${after.minRestDaysPerWeek ?? 1}일`);

  if ((before.maxConsecutiveDays || 5) !== (after.maxConsecutiveDays || 5))
    push('연속근무 상한', `${before.maxConsecutiveDays || 5}일`, `${after.maxConsecutiveDays || 5}일`);

  if ((before.dailyWorkHours || 8) !== (after.dailyWorkHours || 8))
    push('하루 근무시간', `${before.dailyWorkHours}h`, `${after.dailyWorkHours}h`);

  if (before.position !== after.position)
    push('직급', before.position, after.position);

  if (before.employmentType !== after.employmentType) {
    const m = { hourly: '시급제', monthly: '월급제', shortTerm: '단기' };
    push('고용 형태', m[before.employmentType] || before.employmentType,
                      m[after.employmentType]  || after.employmentType);
  }

  return diffs;
}

function _recordPendingChange(empId, name, changes) {
  const list = State.ui.pendingEmployeeChanges;
  const existing = list.find(c => c.empId === empId);
  if (existing) {
    existing.name = name;
    // 같은 항목은 최신 값으로 갱신
    for (const ch of changes) {
      const prev = existing.changes.find(c => c.label === ch.label);
      if (prev) prev.to = ch.to;
      else existing.changes.push(ch);
    }
  } else {
    list.push({ empId, name, changes });
  }
}

function deleteEmployee(tabContainer, id, afterDelete) {
  const emp = State.getEmployee(id);
  if (!emp) return;
  const schCount = State.getSchedulesByEmployee(id).length;
  if (!confirm(`${emp.name}님을 삭제하시겠습니까? 관련 스케줄 ${schCount}건도 함께 삭제됩니다.`)) return;
  State.removeEmployee(id);
  // 삭제로 인원이 빈 날짜가 생기므로 스케줄 확인 대상에 기록
  if (schCount > 0) {
    _recordPendingChange(id, emp.name, [{ label: '직원 삭제', from: `근무 ${schCount}건`, to: '삭제됨' }]);
  }
  showToast(`${emp.name}님이 삭제되었습니다.`);
  if (typeof afterDelete === 'function') afterDelete();
  renderEmployeesTab(tabContainer);
}

// ── 캘린더 드로어 (휴무 / 근무 가능요일) ─────────
function openCalendarDrawer(tabContainer, employeeId, mode) {
  const emp = State.getEmployee(employeeId);
  if (!emp) return;

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';

  const modeLabel = mode === 'holiday' ? '휴무 신청' : '고정 근무일 지정';
  drawer.innerHTML = `
<div class="drawer-header">
  <h2>${esc(emp.name)} — ${modeLabel}</h2>
  <button class="drawer-close">✕</button>
</div>
<div id="cal-drawer-body"></div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const calBody = drawer.querySelector('#cal-drawer-body');
  const beforeCount = mode === 'holiday'
    ? (emp.holidayRequests || []).length
    : (emp.preferredDates || []).length;

  renderCalendar(calBody, {
    year: State.ui.currentYear,
    month: State.ui.currentMonth,
    employeeId,
    mode,
    onSave: () => {
      const now = State.getEmployee(employeeId);
      const afterCount = mode === 'holiday'
        ? (now.holidayRequests || []).length
        : (now.preferredDates  || []).length;
      if (afterCount !== beforeCount) {
        _recordPendingChange(employeeId, now.name, [{
          label: mode === 'holiday' ? '휴무 신청일' : '고정 근무일',
          from: `${beforeCount}일`,
          to:   `${afterCount}일`,
        }]);
      }
    },
  });

  const closeDrawer = () => { overlay.remove(); drawer.remove(); };
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
}

// ══════════════════════════════════════════════════════
// 설정 탭
// ══════════════════════════════════════════════════════
function renderSettingsTab(container) {
  const opDays    = State.settings.storeOperatingDays;
  const dayNames  = ['일','월','화','수','목','금','토'];
  const ir        = State.settings.insuranceRates;
  const rsd       = State.settings.requiredStaffByDay || {};
  const positions = State.settings.positions || [];

  const dayBtns = dayNames.map((n, i) => `
<button class="day-checkbox ${opDays.includes(i) ? 'active' : ''}"
        data-action="toggle-op-day" data-day="${i}">${n}</button>
  `).join('');

  const positionList = positions.map((p, idx) => `
<div class="pos-item" data-idx="${idx}">
  <span class="pos-rank">${idx + 1}</span>
  <span class="pos-name">${esc(p.name)}</span>
  <button class="btn btn-xs btn-ghost pos-move" data-action="pos-up" data-idx="${idx}"
          ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
  <button class="btn btn-xs btn-ghost pos-move" data-action="pos-down" data-idx="${idx}"
          ${idx === positions.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
  <button class="btn btn-xs ${p.isAdmin ? 'btn-admin-on' : 'btn-admin-off'}"
          data-action="toggle-pos-admin" data-idx="${idx}">
    ${p.isAdmin ? '★ 관리자' : '일반직'}
  </button>
  <button class="btn btn-xs btn-ghost" data-action="delete-pos" data-idx="${idx}">✕</button>
</div>`).join('');

  container.innerHTML = `
<div class="section-header"><h2>설정</h2></div>

<!-- 직급 관리 -->
<div class="settings-card" style="margin-bottom:16px">
  <h3>직급 관리</h3>
  <div class="pos-list" id="pos-list">${positionList || '<p style="color:var(--gray-400);font-size:.85rem">등록된 직급이 없습니다.</p>'}</div>
  <div class="pos-add-row" style="margin-top:12px;display:flex;gap:8px;align-items:center">
    <input type="text" id="new-pos-name" placeholder="새 직급 이름" style="flex:1;padding:6px 10px;border:1px solid var(--gray-200);border-radius:var(--radius)">
    <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;white-space:nowrap">
      <input type="checkbox" id="new-pos-admin"> 관리자
    </label>
    <button class="btn btn-primary btn-sm" id="add-pos-btn">추가</button>
  </div>
  <p class="settings-hint">
    ★ 관리자는 자동 생성 시 우선 배치됩니다.<br>
    위에 있을수록 높은 직급이며, 목록에서도 위에 표시됩니다.
  </p>
</div>

<!-- 근무 설정 -->
<div class="settings-card" style="margin-bottom:16px">
  <h3>근무 설정</h3>
  <div class="settings-row">
    <label>최대 주 근무시간</label>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="number" id="max-week-hours" value="${State.settings.weeklyMaximumHours}" min="1" max="68">
      <span>시간</span>
    </div>
  </div>
  <div class="settings-row" style="flex-wrap:wrap;gap:12px">
    <label>매장 영업 요일</label>
    <div class="operating-days">${dayBtns}</div>
  </div>
  <div class="settings-row" style="flex-wrap:wrap;gap:12px;align-items:flex-start">
    <label style="padding-top:4px">요일별 하루 근무 인원</label>
    <div class="staff-per-day-grid">
      ${dayNames.map((n, i) => `
        <div class="staff-day-cell">
          <span class="staff-day-label ${i===0||i===6?'red-day':''}">${n}</span>
          <input type="number" class="staff-day-input" id="staff-day-${i}"
                 value="${rsd[i] ?? 2}" min="0" max="30">
          <span class="staff-day-unit">명</span>
        </div>`).join('')}
    </div>
  </div>
  <button class="btn btn-primary" id="save-settings">저장</button>
</div>

<!-- 4대보험 요율 설정 -->
<div class="settings-card" style="margin-bottom:16px">
  <h3>4대보험 요율 설정 <small style="font-weight:400;color:var(--gray-400)">(% 단위)</small></h3>
  <div class="ins-rate-grid">
    <div class="ins-rate-header"></div>
    <div class="ins-rate-header">근로자 (%)</div>
    <div class="ins-rate-header">사업주 (%)</div>

    <div class="ins-rate-label">국민연금</div>
    <div><input type="number" class="ins-input" id="ir-np-emp" value="${ir.nationalPension.employee}" min="0" max="20" step="0.01"></div>
    <div><input type="number" class="ins-input" id="ir-np-er"  value="${ir.nationalPension.employer}" min="0" max="20" step="0.01"></div>

    <div class="ins-rate-label">건강보험</div>
    <div><input type="number" class="ins-input" id="ir-hi-emp" value="${ir.healthInsurance.employee}" min="0" max="20" step="0.001"></div>
    <div><input type="number" class="ins-input" id="ir-hi-er"  value="${ir.healthInsurance.employer}" min="0" max="20" step="0.001"></div>

    <div class="ins-rate-label">장기요양보험 <small>(건강보험료×)</small></div>
    <div><input type="number" class="ins-input" id="ir-ltc" value="${ir.longTermCareRate}" min="0" max="50" step="0.01"></div>
    <div><span style="color:var(--gray-400);font-size:.8rem">동일 적용</span></div>

    <div class="ins-rate-label">고용보험</div>
    <div><input type="number" class="ins-input" id="ir-ei-emp" value="${ir.employmentInsurance.employee}" min="0" max="10" step="0.01"></div>
    <div><input type="number" class="ins-input" id="ir-ei-er"  value="${ir.employmentInsurance.employer}" min="0" max="10" step="0.01"></div>

    <div class="ins-rate-label">산재보험 <small>(사업주 전액)</small></div>
    <div><span style="color:var(--gray-400);font-size:.8rem">해당없음</span></div>
    <div><input type="number" class="ins-input" id="ir-ia-er"  value="${ir.industrialAccident.employer}" min="0" max="20" step="0.01"></div>
  </div>
  <button class="btn btn-primary" id="save-insurance" style="margin-top:12px">보험 요율 저장</button>
</div>

<!-- 데이터 관리 -->
<div class="settings-card">
  <h3>데이터 관리</h3>
  <div class="reset-section">
    <p>모든 직원 및 스케줄 데이터를 초기화합니다. 이 작업은 되돌릴 수 없습니다.</p>
    <button class="btn btn-danger" id="reset-all">전체 초기화</button>
  </div>
</div>`;

  // ── 직급 이벤트 ───────────────────────────
  document.getElementById('add-pos-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('new-pos-name');
    const name = nameInput.value.trim();
    if (!name) { showToast('직급 이름을 입력해 주세요.', 'error'); return; }
    if (State.settings.positions.some(p => p.name === name)) {
      showToast('이미 존재하는 직급입니다.', 'error'); return;
    }
    const isAdmin = document.getElementById('new-pos-admin').checked;
    State.settings.positions.push({ name, isAdmin });
    State.save();
    nameInput.value = '';
    document.getElementById('new-pos-admin').checked = false;
    renderSettingsTab(container);
    showToast(`'${name}' 직급이 추가되었습니다.`);
  });

  // 엔터키로 추가
  document.getElementById('new-pos-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-pos-btn').click();
  });

  if (container._settingsHandler) container.removeEventListener('click', container._settingsHandler);
  container._settingsHandler = e => {
    const action = e.target.dataset.action;
    const idx    = parseInt(e.target.dataset.idx);

    if (action === 'toggle-op-day') {
      const day  = parseInt(e.target.dataset.day);
      const days = State.settings.storeOperatingDays;
      const i    = days.indexOf(day);
      if (i === -1) days.push(day); else days.splice(i, 1);
      days.sort((a, b) => a - b);
      e.target.classList.toggle('active');
      State.save(); // 즉시 저장 (저장 버튼 안 눌러도 유실 방지)

    } else if (action === 'pos-up' || action === 'pos-down') {
      const arr = State.settings.positions;
      const to  = action === 'pos-up' ? idx - 1 : idx + 1;
      if (to < 0 || to >= arr.length) return;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      State.save();
      renderSettingsTab(container);

    } else if (action === 'toggle-pos-admin') {
      State.settings.positions[idx].isAdmin = !State.settings.positions[idx].isAdmin;
      State.save();
      renderSettingsTab(container);

    } else if (action === 'delete-pos') {
      const posName = State.settings.positions[idx]?.name;
      if (!confirm(`'${posName}' 직급을 삭제하시겠습니까?`)) return;
      State.settings.positions.splice(idx, 1);
      State.save();
      renderSettingsTab(container);
      showToast(`'${posName}' 직급이 삭제되었습니다.`);
    }
  };
  container.addEventListener('click', container._settingsHandler);

  // 근무 설정 저장
  document.getElementById('save-settings').addEventListener('click', () => {
    const hrs = parseInt(document.getElementById('max-week-hours').value);
    if (!hrs || hrs < 1) { showToast('올바른 시간을 입력해 주세요.', 'error'); return; }
    State.settings.weeklyMaximumHours = hrs;
    const staffByDay = {};
    for (let i = 0; i < 7; i++) {
      staffByDay[i] = parseInt(document.getElementById(`staff-day-${i}`)?.value) || 0;
    }
    State.settings.requiredStaffByDay = staffByDay;
    State.save();
    showToast('설정이 저장되었습니다.');
  });

  // 보험 요율 저장
  document.getElementById('save-insurance').addEventListener('click', () => {
    const g = id => parseFloat(document.getElementById(id).value) || 0;
    State.settings.insuranceRates = {
      nationalPension:     { employee: g('ir-np-emp'), employer: g('ir-np-er')  },
      healthInsurance:     { employee: g('ir-hi-emp'), employer: g('ir-hi-er')  },
      longTermCareRate:    g('ir-ltc'),
      employmentInsurance: { employee: g('ir-ei-emp'), employer: g('ir-ei-er')  },
      industrialAccident:  { employer: g('ir-ia-er')  },
    };
    State.save();
    showToast('보험 요율이 저장되었습니다.');
  });

  // 전체 초기화
  document.getElementById('reset-all').addEventListener('click', () => {
    if (!confirm('모든 데이터를 삭제하고 처음부터 시작하시겠습니까?')) return;
    State.reset();
    showToast('초기화되었습니다.');
    switchView('welcome');
  });
}

// ══════════════════════════════════════════════════════
// 전역 이벤트 바인딩
// ══════════════════════════════════════════════════════
function bindGlobalEvents() {
  document.getElementById('app-nav')?.addEventListener('click', e => {
    const tab = e.target.dataset.tab;
    if (tab) switchTab(tab);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // 생성 진행 중에는 ESC로 닫히지 않도록 차단
      if (document.getElementById('sch-progress-overlay')) return;
      document.querySelector('.drawer')?.remove();
      document.querySelector('.drawer-overlay')?.remove();
      document.querySelector('.modal-backdrop')?.remove();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
