// scheduleUI.js — 스케줄 화면 (클릭 선택/교환 방식)

import { State } from './state.js';
import { renderScheduleCalendar, showToast } from './calendar.js';
import { moveSchedule, swapSchedules, generateSchedule, validateSchedule, countConsecutiveIfAdded, detectScheduleConflicts } from './schedule.js';
import { exportScheduleImage } from './scheduleExport.js';
import { compareByRank } from './employees.js';
import { getDaysInMonth, getWeekKey, formatDateKo, esc } from './holidays.js';

// ── 선택 상태 (클릭 기반 이동/교환) ──────────
let _selectedEntry    = null; // { schId, empId, date, empName }
let _scheduleSnapshot = null; // 되돌리기용 스냅샷
let _ctxCleanup       = null; // 컨텍스트 메뉴 리스너 해제 함수
let _filterEmpId      = null; // 직원 필터 (null = 전체 보기)

// ══════════════════════════════════════════════════════
// 스케줄 탭 진입점
// ══════════════════════════════════════════════════════
export function renderScheduleTab(container) {
  _selectedEntry = null; // 탭 재렌더링 시 선택 초기화

  const { scheduleYear: year, scheduleMonth: month } = State.ui;

  container.innerHTML = `
<div class="section-header">
  <h2>스케줄 관리</h2>
  <div class="schedule-actions">
    <button class="btn btn-outline" data-action="sch-prev-month">‹ 이전달</button>
    <span class="month-label">${year}년 ${month}월</span>
    <button class="btn btn-outline" data-action="sch-next-month">다음달 ›</button>
    <button class="btn btn-primary" data-action="generate-schedule">자동 생성</button>
    <button class="btn btn-outline" data-action="export-image">🖼 이미지 저장</button>
    ${_scheduleSnapshot ? `<button class="btn btn-warn" data-action="undo-schedule">↩ 되돌리기</button>` : ''}
    <button class="btn btn-danger-outline" data-action="clear-schedule">초기화</button>
  </div>
</div>

<div class="schedule-legend">
  <button class="legend-item legend-all${_filterEmpId ? '' : ' legend-active'}"
          data-action="filter-emp" data-emp-id="">
    전체 보기
  </button>
  ${State.employees.slice().sort(compareByRank).map(emp => `
    <button class="legend-item${_filterEmpId === emp.id ? ' legend-active' : ''}"
            data-action="filter-emp" data-emp-id="${emp.id}">
      <span class="legend-color" style="background:${esc(emp.color)}"></span>
      ${esc(emp.name)}
    </button>`).join('')}
</div>

<p class="sch-hint">
  ${_filterEmpId
    ? `<strong>${esc(State.getEmployee(_filterEmpId)?.name || '')}</strong>만 보는 중`
    : `클릭 이동·교환 · 더블클릭 시간 수정 · 우클릭 메뉴`}
</p>

<div id="conflict-banner"></div>
<div id="schedule-calendar-wrapper"></div>
<div id="validation-report-wrapper"></div>
<div id="weekly-summary-wrapper"></div>`;

  _refreshCalendar(container);
  _bindScheduleEvents(container);

  // 직원 편집으로 인한 변경사항이 있으면 안내
  if (State.ui.pendingEmployeeChanges?.length) {
    _showEmployeeChangeNotice(container);
  }
}

// ══════════════════════════════════════════════════════
// 직원 편집 변경사항 안내
// ══════════════════════════════════════════════════════
function _showEmployeeChangeNotice(container) {
  const changes = State.ui.pendingEmployeeChanges;
  if (!changes?.length) return;

  const { scheduleYear: year, scheduleMonth: month } = State.ui;

  // 스케줄이 아직 없으면 안내할 필요가 없으므로 기록만 정리
  if (State.getSchedulesByMonth(year, month).length === 0) {
    State.ui.pendingEmployeeChanges = [];
    return;
  }

  document.getElementById('emp-change-modal')?.remove();
  const conf = detectScheduleConflicts(year, month);

  const rows = changes.map(c => `
<li class="change-item">
  <div class="change-emp">${esc(c.name)}</div>
  <ul class="change-detail-list">
    ${c.changes.map(ch => `
      <li class="change-detail">
        <span class="change-label">${esc(ch.label)}</span>
        <span class="change-arrow">${esc(ch.from)} → <strong>${esc(ch.to)}</strong></span>
      </li>`).join('')}
  </ul>
</li>`).join('');

  const hasIssue = conf.entryCount > 0 || conf.dateCount > 0;

  const modal = document.createElement('div');
  modal.id = 'emp-change-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box modal-wide">
  <h3 class="modal-title">직원 정보가 바뀌었습니다</h3>
  <p class="modal-body">지금 스케줄과 안 맞을 수 있습니다.</p>

  <ul class="change-list">${rows}</ul>

  ${hasIssue ? `
  <div class="change-result change-result-bad">
    <strong>근무 ${conf.entryCount}건, ${conf.dateCount}일에 문제가 있습니다.</strong>
    <div class="change-legend">
      <span><i class="lg-box lg-yellow"></i> 노랑 — 제약 위반</span>
      <span><i class="lg-box lg-red"></i> 빨강 — 인원 부족·관리자 없음</span>
    </div>
    <p class="change-hint">달력에서 고치거나 다시 생성하면 됩니다.</p>
  </div>` : `
  <div class="change-result change-result-ok">
    스케줄에 문제 없습니다.
  </div>`}

  <div class="modal-actions">
    <button class="btn btn-ghost" id="chg-ignore">나중에</button>
    ${hasIssue ? `<button class="btn btn-primary" id="chg-review">확인</button>` : ''}
  </div>
</div>`;

  document.body.appendChild(modal);

  const clearAndClose = () => {
    State.ui.pendingEmployeeChanges = [];
    modal.remove();
    _refreshCalendar(container);
  };

  modal.querySelector('#chg-ignore').addEventListener('click', () => {
    // 나중에 확인 — 기록은 유지하되 이번엔 닫기만
    modal.remove();
  });
  modal.querySelector('#chg-review')?.addEventListener('click', clearAndClose);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // 문제가 없으면 기록을 즉시 비움
  if (!hasIssue) State.ui.pendingEmployeeChanges = [];
}

// ══════════════════════════════════════════════════════
// 달력 + 주간요약 + 검증 새로고침 (공통 헬퍼)
// ══════════════════════════════════════════════════════
function _refreshCalendar(container) {
  const { scheduleYear: year, scheduleMonth: month } = State.ui;

  // 충돌 감지 → 달력에 색으로 표시
  const conflicts = detectScheduleConflicts(year, month);

  const calWrap = container.querySelector('#schedule-calendar-wrapper');
  if (calWrap) renderScheduleCalendar(calWrap, year, month, _filterEmpId, conflicts);

  // 상단 요약 배너
  const banner = container.querySelector('#conflict-banner');
  if (banner) {
    if (conflicts.entryCount || conflicts.dateCount) {
      banner.innerHTML = `
<div class="conflict-banner">
  <span class="cb-icon">⚠</span>
  <span class="cb-text">
    ${conflicts.entryCount ? `<b class="cb-yellow">근무 ${conflicts.entryCount}건</b>` : ''}
    ${conflicts.entryCount && conflicts.dateCount ? ' · ' : ''}
    ${conflicts.dateCount ? `<b class="cb-red">${conflicts.dateCount}일</b>` : ''}
    확인이 필요합니다
  </span>
  <span class="cb-legend">
    <i class="lg-box lg-yellow"></i> 제약 위반
    <i class="lg-box lg-red"></i> 인원·관리자
  </span>
</div>`;
    } else {
      banner.innerHTML = '';
    }
  }

  const sumWrap = container.querySelector('#weekly-summary-wrapper');
  if (sumWrap) _renderWeeklySummary(sumWrap, year, month);

  const valWrap = container.querySelector('#validation-report-wrapper');
  if (valWrap) _renderValidationReportInto(valWrap, year, month);
}

// ══════════════════════════════════════════════════════
// 선택 표시 헬퍼
// ══════════════════════════════════════════════════════

/** 선택 상태를 화면에 반영 — 선택 태그 강조 + 교환 불가 대상 흐리게 */
function _paintSelection() {
  document.querySelectorAll('.emp-tag').forEach(t => {
    t.classList.remove('tag-selected', 'tag-blocked');
  });
  if (!_selectedEntry) return;

  const { schId, empId, date } = _selectedEntry;

  // 선택된 태그 강조
  document.querySelector(`.emp-tag[data-sch-id="${schId}"]`)?.classList.add('tag-selected');

  // 교환 시 중복이 발생하는 상대를 미리 표시
  document.querySelectorAll('.emp-tag[data-action="select-staff"]').forEach(t => {
    const tSch  = t.dataset.schId;
    const tEmp  = t.dataset.empId;
    const tDate = t.dataset.date;
    if (tSch === schId) return;

    // ① 선택된 직원이 상대 날짜에 이미 있음
    const aOnB = State.schedules.some(
      s => s.id !== schId && s.date === tDate && s.employeeId === empId
    );
    // ② 상대 직원이 선택된 날짜에 이미 있음
    const bOnA = State.schedules.some(
      s => s.id !== tSch && s.date === date && s.employeeId === tEmp
    );
    if (aOnB || bOnA) {
      t.classList.add('tag-blocked');
      t.title = '교환 불가 — 같은 날 중복 배정이 발생합니다';
    }
  });
}

/** 선택 해제 + 표시 초기화 */
function _clearSelection() {
  _selectedEntry = null;
  document.querySelectorAll('.emp-tag').forEach(t => {
    t.classList.remove('tag-selected', 'tag-blocked');
  });
}

// ══════════════════════════════════════════════════════
// 클릭 선택 / 교환 / 이동 로직
// ══════════════════════════════════════════════════════

/** emp-tag 클릭: 선택 or 교환 */
function _onSelectStaff(schId, empId, date, container) {
  const empName = State.getEmployee(empId)?.name || '';

  // 아무것도 선택되지 않은 상태 → 선택
  if (!_selectedEntry) {
    _selectedEntry = { schId, empId, date, empName };
    _paintSelection();
    showToast(`${empName} 선택 — 옮길 날짜나 바꿀 직원을 클릭`, 'info', 2200);
    return;
  }

  // 같은 태그 → 선택 취소
  if (_selectedEntry.schId === schId) {
    _clearSelection();
    return;
  }

  // 다른 태그 → 두 근무일 교환 (유효성 먼저 확인, 실패 시 선택 유지)
  const from = _selectedEntry;

  // ── 교환 전 중복 체크 ──
  // 선택된 직원(from.empId)이 클릭한 날짜(date)에 이미 배정되어 있으면 교환 불가
  const fromEmpOnTargetDate = State.schedules.some(
    s => s.id !== from.schId && s.date === date && s.employeeId === from.empId
  );
  // 클릭한 직원(empId)이 선택된 날짜(from.date)에 이미 배정되어 있으면 교환 불가
  const targetEmpOnFromDate = State.schedules.some(
    s => s.id !== schId && s.date === from.date && s.employeeId === empId
  );

  if (fromEmpOnTargetDate) {
    showToast(`${from.empName}이(가) ${formatDateKo(date)}에 이미 있어 바꿀 수 없습니다.`, 'error', 3500);
    return; // 선택 유지
  }
  if (targetEmpOnFromDate) {
    showToast(`${empName}이(가) ${formatDateKo(from.date)}에 이미 있어 바꿀 수 없습니다.`, 'error', 3500);
    return; // 선택 유지
  }

  // 유효 → 선택 해제 후 교환
  _clearSelection();

  const result = swapSchedules(from.schId, from.date, schId, date);
  if (!result.ok) {
    if (result.overtime) _showOvertimeWarning(result.reason);
    else showToast(result.reason, 'error');
    return;
  }
  showToast(`${from.empName} ↔ ${empName} 교환 완료`);
  _refreshCalendar(container);
}

/** 빈 날짜 공간 클릭: 선택된 직원을 이동 */
function _onPlaceStaff(targetDate, container) {
  if (!_selectedEntry) return;

  const { schId, date: fromDate, empId, empName } = _selectedEntry;

  // 같은 날짜 클릭 → 선택 취소
  if (fromDate === targetDate) {
    _clearSelection();
    return;
  }

  // ── 이동 전 중복 체크 (선택 유지 상태에서 검사) ──
  const alreadyThere = State.schedules.some(
    s => s.id !== schId && s.date === targetDate && s.employeeId === empId
  );
  if (alreadyThere) {
    showToast(`${empName}님은 ${formatDateKo(targetDate)}에 이미 배정되어 있습니다.`, 'error');
    return; // 선택 유지 — 다른 날짜를 다시 클릭할 수 있음
  }

  // 유효 → 선택 해제 후 이동 시도
  _clearSelection();

  const result = moveSchedule(schId, targetDate);

  if (!result.ok) {
    if (result.overtime) {
      // 52h 초과 → 경고 다이얼로그 표시, 이동 차단
      _showOvertimeWarning(result.reason);
    } else {
      showToast(result.reason, 'error');
    }
    return;
  }

  showToast(`${empName}님을 ${formatDateKo(targetDate)}로 이동했습니다.`);
  _refreshCalendar(container);
}

/** 52h 초과 경고 다이얼로그 (이동 차단 — 확인 버튼으로 닫기만 가능) */
function _showOvertimeWarning(reason) {
  document.getElementById('overtime-confirm-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'overtime-confirm-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box">
  <h3 class="modal-title" style="color:var(--danger)">주 근무시간 초과</h3>
  <p class="modal-body" style="white-space:pre-line">${reason}</p>
  <div class="modal-actions">
    <button class="btn btn-primary" id="ot-close">확인</button>
  </div>
</div>`;

  document.body.appendChild(modal);
  document.getElementById('ot-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ══════════════════════════════════════════════════════
// 근무시간 수정 모달 (해당 날짜 · 해당 근무자만)
// ══════════════════════════════════════════════════════
function _showHoursEditor(schId, container) {
  const sch = State.schedules.find(s => s.id === schId);
  if (!sch) { showToast('스케줄을 찾을 수 없습니다.', 'error'); return; }
  const emp = State.getEmployee(sch.employeeId);
  if (!emp) { showToast('직원 정보를 찾을 수 없습니다.', 'error'); return; }

  document.getElementById('hours-edit-modal')?.remove();

  const weekKey  = getWeekKey(sch.date);
  const maxHrs   = State.settings.weeklyMaximumHours;
  const current  = sch.workingHours ?? emp.dailyWorkHours ?? 8;
  const weekOther = State.getWeeklyHours(emp.id, weekKey) - current; // 이 건 제외한 주간 합
  const isMonthly = emp.employmentType === 'monthly';
  const rate      = emp.hourlyWage || emp.wage || 0;

  const modal = document.createElement('div');
  modal.id = 'hours-edit-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box">
  <div class="modal-header">
    <h3 class="modal-title">근무시간 수정</h3>
    <span class="modal-date-label">${formatDateKo(sch.date)}</span>
  </div>

  <div class="hours-emp-row">
    <span class="emp-picker-dot" style="background:${esc(emp.color)}"></span>
    <strong>${esc(emp.name)}</strong>
    <span class="hours-emp-meta">${esc(emp.position)} · 기본 ${emp.dailyWorkHours || 8}h</span>
  </div>

  <div class="hours-row">
    <label for="edit-hours">근무시간</label>
    <input type="number" id="edit-hours" min="0.5" max="24" step="0.5" value="${current}">
    <span class="hours-unit">시간</span>
  </div>

  <div class="hours-quick">
    ${[4, 6, 8, 9, 10, 12].map(h =>
      `<button class="btn btn-xs hours-preset" data-h="${h}">${h}h</button>`).join('')}
  </div>

  <div class="hours-preview" id="hours-preview"></div>

  <div class="modal-actions">
    <button class="btn btn-ghost" id="hours-cancel">취소</button>
    <button class="btn btn-primary" id="hours-save">저장</button>
  </div>
</div>`;

  document.body.appendChild(modal);

  const input   = modal.querySelector('#edit-hours');
  const preview = modal.querySelector('#hours-preview');

  const refresh = () => {
    const h = parseFloat(input.value) || 0;
    const weekTotal = weekOther + h;
    const over = weekTotal > maxHrs;
    const payLine = isMonthly
      ? '월급제 — 이 날 시간은 급여액에 직접 반영되지 않습니다.'
      : `이 날 급여 <strong>${Math.round(h * rate).toLocaleString()}원</strong> (시급 ${rate.toLocaleString()}원)`;

    preview.innerHTML = `
      <div class="hours-preview-line">주간 합계 <strong class="${over ? 'over-limit' : ''}">${weekTotal}h</strong> / ${maxHrs}h</div>
      <div class="hours-preview-line">${payLine}</div>
      ${over ? `<div class="hours-preview-warn">⚠ 주 ${maxHrs}시간을 초과합니다.</div>` : ''}`;
  };
  refresh();

  input.addEventListener('input', refresh);
  modal.querySelectorAll('.hours-preset').forEach(b => {
    b.addEventListener('click', () => { input.value = b.dataset.h; refresh(); });
  });

  const close = () => modal.remove();
  modal.querySelector('#hours-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') modal.querySelector('#hours-save').click(); });

  modal.querySelector('#hours-save').addEventListener('click', () => {
    const h = parseFloat(input.value);
    if (!h || h <= 0 || h > 24) {
      showToast('근무시간은 0.5~24 사이로 입력해 주세요.', 'error');
      input.focus();
      return;
    }
    if (!_isFullTimeAdminUI(emp) && weekOther + h > maxHrs) {
      _showOvertimeWarning(
        `${emp.name}님의 이번 주 근무시간이 ${maxHrs}시간을 초과합니다.\n` +
        `다른 근무 ${weekOther}h + 이 근무 ${h}h = ${weekOther + h}h`
      );
      return;
    }
    State.updateSchedule(schId, { workingHours: h });
    showToast(`${emp.name}님 ${formatDateKo(sch.date)} 근무시간을 ${h}시간으로 변경했습니다.`);
    close();
    _refreshCalendar(container);
  });

  setTimeout(() => { input.focus(); input.select(); }, 30);
}

// ══════════════════════════════════════════════════════
// 우클릭 컨텍스트 메뉴 (삭제 / 시간 수정)
// ══════════════════════════════════════════════════════
function _showTagContextMenu(x, y, schId, empId, date, container) {
  _closeContextMenu();

  const emp = State.getEmployee(empId);
  const empName = emp?.name || '직원';

  const menu = document.createElement('div');
  menu.id = 'tag-context-menu';
  menu.className = 'tag-ctx-menu';
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  const sch = State.schedules.find(s => s.id === schId);
  const hrs = sch?.workingHours ?? emp?.dailyWorkHours ?? 8;

  menu.innerHTML = `
<div class="ctx-menu-header">${esc(empName)} · ${date} · ${hrs}h</div>
<button class="ctx-menu-item" data-action="ctx-hours">
  ⏱ 근무시간 수정
</button>
<button class="ctx-menu-item ctx-delete" data-action="ctx-delete">
  🗑 근무 삭제
</button>`;

  document.body.appendChild(menu);

  // 화면 밖으로 넘어가면 위쪽으로
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${y - rect.height}px`;
  }
  if (rect.right > window.innerWidth) {
    menu.style.left = `${x - rect.width}px`;
  }

  menu.querySelector('[data-action="ctx-hours"]').addEventListener('click', () => {
    _closeContextMenu();
    _showHoursEditor(schId, container);
  });

  menu.querySelector('[data-action="ctx-delete"]').addEventListener('click', () => {
    _closeContextMenu();
    State.removeSchedule(schId);
    showToast(`${empName}님 ${date} 근무가 삭제되었습니다.`);
    _refreshCalendar(container);
  });

  // 바깥 클릭 / 스크롤 / ESC 시 닫기 — 리스너는 _closeContextMenu에서 일괄 해제
  const onOutside = e => { if (!menu.contains(e.target)) _closeContextMenu(); };
  const onScroll  = () => _closeContextMenu();
  const onKey     = e => { if (e.key === 'Escape') _closeContextMenu(); };

  _ctxCleanup = () => {
    document.removeEventListener('click', onOutside);
    window.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKey);
    _ctxCleanup = null;
  };

  setTimeout(() => {
    document.addEventListener('click', onOutside);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function _closeContextMenu() {
  document.getElementById('tag-context-menu')?.remove();
  if (_ctxCleanup) _ctxCleanup();
}

// ══════════════════════════════════════════════════════
// 이벤트 바인딩 (단일 위임 핸들러)
// ══════════════════════════════════════════════════════
function _bindScheduleEvents(container) {
  if (container._schedHandler)    container.removeEventListener('click',       container._schedHandler);
  if (container._schedCtxHandler) container.removeEventListener('contextmenu', container._schedCtxHandler);
  if (container._schedDblHandler) container.removeEventListener('dblclick',    container._schedDblHandler);

  // ── 더블클릭(왼쪽): 근무시간 수정 ──
  container._schedDblHandler = e => {
    const tag = e.target.closest('[data-action="select-staff"]');
    if (!tag || tag.classList.contains('emp-tag-dimmed')) return;
    e.preventDefault();
    _clearSelection();
    _showHoursEditor(tag.dataset.schId, container);
  };
  container.addEventListener('dblclick', container._schedDblHandler);

  // ── 우클릭: emp-tag 위에서만 컨텍스트 메뉴 표시 ──
  container._schedCtxHandler = e => {
    const tag = e.target.closest('[data-action="select-staff"]');
    if (!tag) return;
    e.preventDefault();
    _closeContextMenu();
    _showTagContextMenu(e.clientX, e.clientY, tag.dataset.schId, tag.dataset.empId, tag.dataset.date, container);
  };
  container.addEventListener('contextmenu', container._schedCtxHandler);

  container._schedHandler = e => {
    // 컨텍스트 메뉴 닫기 (다른 곳 클릭 시)
    if (!e.target.closest('#tag-context-menu')) _closeContextMenu();

    // 0) 범례 클릭 (직원 필터)
    const legendBtn = e.target.closest('[data-action="filter-emp"]');
    if (legendBtn) {
      const id = legendBtn.dataset.empId || null;
      // 같은 직원 다시 클릭 → 필터 해제
      _filterEmpId = (id && _filterEmpId === id) ? null : id;
      _selectedEntry = null;
      renderScheduleTab(container);
      return;
    }

    // 1) + 버튼 (근무자 추가)
    const addBtn = e.target.closest('[data-action="add-staff"]');
    if (addBtn) {
      _clearSelection();
      _onAddStaff(addBtn.dataset.date, container);
      return;
    }

    // 2) emp-tag 클릭 (선택/교환) — 필터로 흐려진 태그는 무시
    const tag = e.target.closest('[data-action="select-staff"]');
    if (tag) {
      if (tag.classList.contains('emp-tag-dimmed')) {
        showToast('필터를 해제해야 편집할 수 있습니다.', 'info', 2000);
        return;
      }
      _onSelectStaff(tag.dataset.schId, tag.dataset.empId, tag.dataset.date, container);
      return;
    }

    // 3) 빈 날짜 공간 클릭 (이동)
    const dayCell = e.target.closest('[data-action="place-staff"]');
    if (dayCell) {
      _onPlaceStaff(dayCell.dataset.date, container);
      return;
    }

    // 4) 상단 버튼 처리
    const action = e.target.dataset.action;
    if (!action) return;

    if (action === 'generate-schedule') {
      _onGenerateSchedule(container);
    } else if (action === 'export-image') {
      _onExportImage();
    } else if (action === 'undo-schedule') {
      _onUndoSchedule(container);
    } else if (action === 'clear-schedule') {
      _onClearSchedule(container);
    } else if (action === 'sch-prev-month' || action === 'sch-prev') {
      _selectedEntry = null;
      let { scheduleYear: y, scheduleMonth: m } = State.ui;
      if (--m < 1) { m = 12; y--; }
      State.ui.scheduleYear = y; State.ui.scheduleMonth = m;
      renderScheduleTab(container);
    } else if (action === 'sch-next-month' || action === 'sch-next') {
      _selectedEntry = null;
      let { scheduleYear: y, scheduleMonth: m } = State.ui;
      if (++m > 12) { m = 1; y++; }
      State.ui.scheduleYear = y; State.ui.scheduleMonth = m;
      renderScheduleTab(container);
    }
  };

  container.addEventListener('click', container._schedHandler);
}

// ══════════════════════════════════════════════════════
// 자동 생성 / 되돌리기 / 초기화
// ══════════════════════════════════════════════════════
// 월요일 시작 순서 (dow 값)
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABEL = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

/** 자동 생성 전 요일별 근무인원 확인·수정 */
function _showStaffPlanModal(container) {
  document.getElementById('staff-plan-modal')?.remove();

  const saved   = State.settings.requiredStaffByDay || {};
  const opDays  = State.settings.storeOperatingDays || [];

  // 요일별로 배정 가능한 직원 수 (참고용)
  const availCount = {};
  DOW_ORDER.forEach(d => {
    availCount[d] = State.employees.filter(e => (e.availableWorkDays || []).includes(d)).length;
  });

  const rows = DOW_ORDER.map(d => {
    const open = opDays.includes(d);
    const cnt  = saved[d] ?? 2;
    const isWknd = (d === 0 || d === 6);
    return `
<div class="plan-row${open ? '' : ' plan-closed'}" data-dow="${d}">
  <button class="plan-open-toggle${open ? ' on' : ''}" data-action="plan-toggle" data-dow="${d}"
          title="${open ? '영업일' : '휴무일'}">${open ? '영업' : '휴무'}</button>
  <span class="plan-day${isWknd ? ' plan-red' : ''}">${DOW_LABEL[d]}</span>
  <div class="plan-stepper">
    <button class="plan-step" data-action="plan-minus" data-dow="${d}" ${open ? '' : 'disabled'}>−</button>
    <input type="number" class="plan-input" id="plan-${d}" value="${cnt}" min="0" max="30"
           ${open ? '' : 'disabled'}>
    <button class="plan-step" data-action="plan-plus" data-dow="${d}" ${open ? '' : 'disabled'}>+</button>
  </div>
  <span class="plan-unit">명</span>
  <span class="plan-avail" id="plan-avail-${d}">가능 ${availCount[d]}명</span>
</div>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'staff-plan-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box modal-wide">
  <div class="modal-header">
    <h3 class="modal-title">요일별 근무인원</h3>
    <span class="modal-date-label">${State.ui.scheduleYear}년 ${State.ui.scheduleMonth}월</span>
  </div>

  <div class="plan-list">${rows}</div>

  <div class="plan-summary" id="plan-summary"></div>

  <label class="plan-save-row">
    <input type="checkbox" id="plan-persist">
    <span>이 설정을 기본값으로 저장</span>
  </label>

  <div class="modal-actions">
    <button class="btn btn-ghost" id="plan-cancel">취소</button>
    <button class="btn btn-primary" id="plan-go">생성</button>
  </div>
</div>`;

  document.body.appendChild(modal);

  const openSet = new Set(opDays);

  const readPlan = () => {
    const req = {};
    DOW_ORDER.forEach(d => {
      const el = modal.querySelector(`#plan-${d}`);
      req[d] = openSet.has(d) ? (parseInt(el.value) || 0) : 0;
    });
    return req;
  };

  const refresh = () => {
    const req = readPlan();
    let weekTotal = 0, warn = [];
    DOW_ORDER.forEach(d => {
      if (!openSet.has(d)) return;
      weekTotal += req[d];
      if (req[d] > availCount[d]) warn.push(`${DOW_LABEL[d]}요일`);
      const el = modal.querySelector(`#plan-avail-${d}`);
      el.classList.toggle('plan-avail-warn', req[d] > availCount[d]);
    });

    modal.querySelector('#plan-summary').innerHTML = `
      <span>주간 연인원 <strong>${weekTotal}명</strong> · 영업 ${openSet.size}일</span>
      ${warn.length ? `<span class="plan-warn">${warn.join(', ')}은 배정 가능 인원보다 많습니다</span>` : ''}`;
  };
  refresh();

  modal.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const d  = parseInt(btn.dataset.dow);
    const el = modal.querySelector(`#plan-${d}`);

    if (btn.dataset.action === 'plan-plus') {
      el.value = Math.min(30, (parseInt(el.value) || 0) + 1);
    } else if (btn.dataset.action === 'plan-minus') {
      el.value = Math.max(0, (parseInt(el.value) || 0) - 1);
    } else if (btn.dataset.action === 'plan-toggle') {
      const nowOpen = !openSet.has(d);
      if (nowOpen) openSet.add(d); else openSet.delete(d);
      btn.classList.toggle('on', nowOpen);
      btn.textContent = nowOpen ? '영업' : '휴무';
      btn.closest('.plan-row').classList.toggle('plan-closed', !nowOpen);
      modal.querySelectorAll(`.plan-row[data-dow="${d}"] .plan-step, #plan-${d}`)
        .forEach(x => { x.disabled = !nowOpen; });
    }
    refresh();
  });

  modal.querySelectorAll('.plan-input').forEach(i => i.addEventListener('input', refresh));

  const close = () => modal.remove();
  modal.querySelector('#plan-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelector('#plan-go').addEventListener('click', () => {
    const req = readPlan();
    const ops = DOW_ORDER.filter(d => openSet.has(d)).sort((a, b) => a - b);

    if (!ops.length) { showToast('영업일을 하나 이상 선택하세요.', 'error'); return; }

    if (modal.querySelector('#plan-persist').checked) {
      State.settings.requiredStaffByDay = { ...req };
      State.settings.storeOperatingDays = ops;
      State.save();
    }

    close();
    _runGenerate(container, { requiredByDay: req, operatingDays: ops });
  });
}

function _onGenerateSchedule(container) {
  if (!State.employees.length) {
    showToast('등록된 직원이 없습니다.', 'error');
    return;
  }
  _showStaffPlanModal(container);
}

async function _runGenerate(container, planOpts) {
  const { scheduleYear: year, scheduleMonth: month } = State.ui;

  _scheduleSnapshot = {
    year, month,
    schedules: JSON.parse(JSON.stringify(State.schedules)),
  };

  const loader = _showProgressOverlay(`${year}년 ${month}월 스케줄 생성 중`);

  try {
    const result = await generateSchedule(year, month, {
      clearFirst: true,
      onProgress: (done, total, best) => loader.update(done, total, best),
      ...planOpts,
    });

    loader.close();

    let msg = `${result.added}건 배정 완료`;
    if (result.violations.length) msg += ` · 확인할 항목 ${result.violations.length}건`;
    showToast(msg, result.violations.length ? 'warn' : 'success', 4500);
    renderScheduleTab(container);
  } catch (err) {
    loader.close();
    console.error('[schedule] 생성 실패:', err);
    showToast('스케줄 생성 중 오류가 발생했습니다.', 'error');
  }
}

// ── 진행률 오버레이 ────────────────────────────
function _showProgressOverlay(title) {
  document.getElementById('sch-progress-overlay')?.remove();

  const el = document.createElement('div');
  el.id = 'sch-progress-overlay';
  el.className = 'progress-backdrop';
  el.innerHTML = `
<div class="progress-box">
  <div class="progress-spinner"></div>
  <h3 class="progress-title">${esc(title)}</h3>
  <div class="progress-bar-outer"><div class="progress-bar-inner" id="sch-pg-bar"></div></div>
  <div class="progress-meta">
    <span id="sch-pg-count">0 / 0</span>
    <span id="sch-pg-score"></span>
  </div>
  <p class="progress-note">여러 조합을 만들어 가장 나은 것을 고르는 중</p>
</div>`;

  document.body.appendChild(el);

  const bar   = el.querySelector('#sch-pg-bar');
  const cnt   = el.querySelector('#sch-pg-count');
  const score = el.querySelector('#sch-pg-score');

  return {
    update(done, total, best) {
      const pct = Math.round((done / total) * 100);
      bar.style.width  = `${pct}%`;
      cnt.textContent  = `${done} / ${total}회 (${pct}%)`;
      score.textContent = Number.isFinite(best) ? `최고 점수 ${best}` : '';
    },
    close() { el.remove(); },
  };
}

// ── 이미지 저장 ────────────────────────────────
function _onExportImage() {
  const { scheduleYear: year, scheduleMonth: month } = State.ui;
  if (!State.getSchedulesByMonth(year, month).length) {
    showToast('저장할 스케줄이 없습니다.', 'error');
    return;
  }
  try {
    const fname = exportScheduleImage(year, month, _filterEmpId);
    showToast(`${fname} 저장됨`, 'success', 3500);
  } catch (err) {
    console.error('[export] 이미지 저장 실패:', err);
    showToast('이미지 저장 실패', 'error');
  }
}

function _onUndoSchedule(container) {
  if (!_scheduleSnapshot) { showToast('되돌릴 스케줄이 없습니다.', 'error'); return; }
  const { year, month, schedules } = _scheduleSnapshot;
  if (!confirm(`${year}년 ${month}월 스케줄을 자동생성 이전으로 되돌리겠습니까?`)) return;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  State.schedules = [
    ...State.schedules.filter(s => !s.date.startsWith(prefix)),
    ...schedules.filter(s => s.date.startsWith(prefix)),
  ];
  State.save();
  _scheduleSnapshot = null;
  showToast(`${year}년 ${month}월 스케줄을 복구했습니다.`);
  renderScheduleTab(container);
}

function _onClearSchedule(container) {
  const { scheduleYear: year, scheduleMonth: month } = State.ui;
  if (!confirm(`${year}년 ${month}월 스케줄을 모두 삭제하시겠습니까?`)) return;
  State.clearSchedulesByMonth(year, month);
  showToast(`${year}년 ${month}월 스케줄이 초기화되었습니다.`);
  renderScheduleTab(container);
}

// ══════════════════════════════════════════════════════
// 근무자 추가 모달 (+ 버튼)
// ══════════════════════════════════════════════════════
/**
 * 이 날짜에 이 직원을 배정할 때 걸리는 제약을 모두 수집
 * @returns {{label:string, detail:string}[]}  비어 있으면 제약 없음
 */
function _collectBlockers(emp, dateStr, hours) {
  const blockers = [];
  const weekKey  = getWeekKey(dateStr);
  const maxHrs   = State.settings.weeklyMaximumHours;
  const dow      = new Date(dateStr + 'T00:00:00').getDay();

  // 휴무 신청은 상근 관리자에게도 적용
  if ((emp.holidayRequests || []).includes(dateStr)) {
    blockers.push({ label: '휴무 신청일', detail: `${emp.name}님이 이 날을 휴무로 신청했습니다.` });
  }

  // 상근 관리자(주 7일)는 나머지 제약 면제
  if (_isFullTimeAdminUI(emp)) return blockers;

  if (!(emp.availableWorkDays || []).includes(dow)) {
    const names = ['일','월','화','수','목','금','토'];
    blockers.push({
      label: '근무 가능요일 아님',
      detail: `${names[dow]}요일은 ${emp.name}님의 근무 가능요일이 아닙니다.`,
    });
  }

  const effMax  = Math.max(1, Math.min(emp.maxWorkDaysPerWeek || 6, 7 - (emp.minRestDaysPerWeek ?? 1)));
  const wkDays  = State.getWeeklyDays(emp.id, weekKey);
  if (wkDays >= effMax) {
    const rest = emp.minRestDaysPerWeek ?? 1;
    blockers.push({
      label: '주 최대 근무일 초과',
      detail: `이번 주 이미 ${wkDays}일 근무 (상한 ${effMax}일 · 휴무 ${rest}일 보장).`,
    });
  }

  const limit  = emp.maxConsecutiveDays || 5;
  const consec = countConsecutiveIfAdded(emp.id, dateStr);
  if (consec > limit) {
    blockers.push({
      label: '연속근무 상한 초과',
      detail: `추가 시 ${consec}일 연속 근무가 됩니다 (상한 ${limit}일).`,
    });
  }

  const wkH = State.getWeeklyHours(emp.id, weekKey);
  if (wkH + hours > maxHrs) {
    blockers.push({
      label: `주 ${maxHrs}시간 초과`,
      detail: `현재 ${wkH}h + ${hours}h = ${wkH + hours}h (한도 ${maxHrs}h).`,
    });
  }

  return blockers;
}

/** 제약 안내 후 강제 추가 여부를 묻는 확인창 */
function _showForceAddConfirm(emp, dateStr, hours, blockers, onConfirm) {
  document.getElementById('force-add-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'force-add-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
<div class="modal-box">
  <h3 class="modal-title" style="color:var(--warn)">배정 제약</h3>
  <p class="modal-body">
    <strong>${esc(emp.name)}</strong> · ${formatDateKo(dateStr)} · ${hours}시간
  </p>

  <ul class="blocker-list">
    ${blockers.map(b => `
      <li class="blocker-item">
        <span class="blocker-label">${esc(b.label)}</span>
        <span class="blocker-detail">${esc(b.detail)}</span>
      </li>`).join('')}
  </ul>

  <p class="modal-body force-ask">그래도 추가할까요?</p>

  <div class="modal-actions">
    <button class="btn btn-ghost" id="force-cancel">취소</button>
    <button class="btn btn-warn" id="force-ok">그대로 추가</button>
  </div>
</div>`;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#force-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#force-ok').addEventListener('click', () => { close(); onConfirm(); });
}

// ══════════════════════════════════════════════════════
// 근무자 추가 모달 (+ 버튼)
// ══════════════════════════════════════════════════════
function _onAddStaff(dateStr, container) {
  if (!dateStr) return;
  const weekKey = getWeekKey(dateStr);

  // 이미 그 날짜에 배정된 직원만 제외 (나머지는 경고와 함께 선택 가능)
  const assigned  = new Set(State.getSchedulesByDate(dateStr).map(s => s.employeeId));
  const available = State.employees
    .filter(emp => !assigned.has(emp.id))
    .sort(compareByRank);

  document.getElementById('add-staff-modal')?.remove();

  const dateLabel = formatDateKo(dateStr);
  const modal = document.createElement('div');
  modal.id = 'add-staff-modal';
  modal.className = 'modal-backdrop';

  const listHTML = available.length
    ? available.map(emp => {
        const wkH      = State.getWeeklyHours(emp.id, weekKey);
        const addHours = emp.dailyWorkHours || 8;
        // 기본 시간 기준으로 미리 제약을 계산해 배지로 안내
        const blockers = _collectBlockers(emp, dateStr, addHours);
        const warn     = blockers.length > 0;

        const badges = blockers
          .map(b => `<span class="blocker-badge">${esc(b.label)}</span>`).join('');

        return `<button class="emp-picker-item${warn ? ' picker-warn' : ''}"
                        data-emp-id="${emp.id}">
          <span class="emp-picker-dot" style="background:${esc(emp.color)}"></span>
          <span class="emp-picker-name">${esc(emp.name)}</span>
          <span class="emp-picker-info">${esc(emp.position)} · 이번주 ${wkH}h · <strong>+${addHours}h</strong></span>
          ${badges ? `<span class="blocker-badges">${badges}</span>` : ''}
        </button>`;
      }).join('')
    : `<p class="emp-picker-empty">이 날짜에 추가할 수 있는 직원이 없습니다. (전원 배정 완료)</p>`;

  modal.innerHTML = `
<div class="modal-box">
  <div class="modal-header">
    <h3 class="modal-title">근무자 추가</h3>
    <span class="modal-date-label">${dateLabel}</span>
  </div>

  <div class="emp-picker-list">${listHTML}</div>
  <p class="picker-legend">
    기본 근무시간으로 추가됩니다. 시간 변경은 추가 후 더블클릭.<br>
    주황색은 제약이 걸린 직원 — 눌러서 사유를 확인할 수 있습니다.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" id="add-staff-cancel">닫기</button>
  </div>
</div>`;

  document.body.appendChild(modal);

  modal.querySelectorAll('.emp-picker-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const empId = btn.dataset.empId;
      const emp   = State.getEmployee(empId);
      if (!emp) return;

      const hours = emp.dailyWorkHours || 8;

      const doAdd = (forced = false) => {
        const ok = State.addSchedule({ date: dateStr, employeeId: empId, workingHours: hours });
        if (ok) {
          showToast(
            `${emp.name}님을 ${dateLabel}에 ${hours}시간으로 추가했습니다.${forced ? ' (제약 무시)' : ''}`,
            forced ? 'warn' : 'success'
          );
          modal.remove();
          _refreshCalendar(container);
        } else {
          showToast('이미 배정된 직원입니다.', 'error');
        }
      };

      // 입력한 시간 기준으로 제약 재계산
      const blockers = _collectBlockers(emp, dateStr, hours);
      if (blockers.length) {
        _showForceAddConfirm(emp, dateStr, hours, blockers, () => doAdd(true));
      } else {
        doAdd();
      }
    });
  });

  document.getElementById('add-staff-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

/** UI 측 상근 관리자 판정 (schedule.js와 동일 규칙) */
function _isFullTimeAdminUI(emp) {
  const positions = State.settings.positions || [];
  const found = positions.find(p => p.name === emp.position);
  return !!(found?.isAdmin) && (emp.maxWorkDaysPerWeek || 0) >= 7;
}

// ══════════════════════════════════════════════════════
// 주간 요약
// ══════════════════════════════════════════════════════
function _renderWeeklySummary(container, year, month) {
  if (!State.employees.length) { container.innerHTML = ''; return; }

  const days     = getDaysInMonth(year, month);
  const weekKeys = [...new Set(days.map(d => getWeekKey(d)))].sort();

  // 필터 적용 시 해당 직원만 표 표시
  const targetEmps = (_filterEmpId
    ? State.employees.filter(e => e.id === _filterEmpId)
    : State.employees.slice()
  ).sort(compareByRank);

  const rows = targetEmps.map(emp => {
    const cells = weekKeys.map(wk => {
      const hrs  = State.getWeeklyHours(emp.id, wk);
      const d    = State.getWeeklyDays(emp.id, wk);
      const over = hrs > State.settings.weeklyMaximumHours;
      return `<td class="${over ? 'over-limit' : ''}">${d}일 / ${hrs}h</td>`;
    }).join('');

    const totalHrs  = days.reduce((sum, d) => {
      const s = State.schedules.find(s => s.date === d && s.employeeId === emp.id);
      return sum + (s ? s.workingHours : 0);
    }, 0);
    const totalDays = State.schedules.filter(s => s.employeeId === emp.id && days.includes(s.date)).length;

    return `<tr>
      <td><span class="emp-dot" style="background:${esc(emp.color)}"></span>${esc(emp.name)}</td>
      ${cells}
      <td><strong>${totalDays}일 / ${totalHrs}h</strong></td>
    </tr>`;
  }).join('');

  const headers = weekKeys.map(wk => {
    const d = new Date(wk + 'T00:00:00');
    return `<th>${d.getMonth()+1}/${d.getDate()} 주</th>`;
  }).join('');

  container.innerHTML = `
<div class="weekly-summary">
  <h3>주간 근무 요약</h3>
  <div class="table-scroll">
    <table class="summary-table">
      <thead><tr><th>직원</th>${headers}<th>합계</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="summary-note">주 ${State.settings.weeklyMaximumHours}시간 초과 시 빨간색</p>
</div>`;
}

// ══════════════════════════════════════════════════════
// 검증 리포트
// ══════════════════════════════════════════════════════
function _renderValidationReportInto(wrapper, year, month) {
  // 생성 전(스케줄 없음)에는 검증 리포트를 띄우지 않는다
  if (State.getSchedulesByMonth(year, month).length === 0) { wrapper.innerHTML = ''; return; }

  const violations = validateSchedule(year, month);
  if (!violations.length) { wrapper.innerHTML = ''; return; }

  const typeLabel = {
    understaffed: '인원 부족', overtime: '주 최대 시간 초과',
    max_days: '주 최대 근무일 초과', holiday_violation: '휴무일 근무',
    duplicate: '중복 배정', no_admin: '관리자 미배치',
    consecutive: '연속근무 상한 초과',
  };
  const items = violations.map(v => {
    let detail = '';
    if (v.type === 'understaffed')           detail = `${v.date} — ${v.assigned}/${v.required}명`;
    else if (v.type === 'overtime')          detail = `${esc(v.empName)} — ${v.weekKey} 주 (${v.hours}h / 최대 ${v.limit}h)`;
    else if (v.type === 'max_days')          detail = `${esc(v.empName)} — ${v.weekKey} 주 (${v.days}일 / 최대 ${v.max}일)`;
    else if (v.type === 'holiday_violation') detail = `${esc(v.empName)} — ${v.date}`;
    else if (v.type === 'duplicate')         detail = `${esc(v.empName)} — ${v.date}`;
    else if (v.type === 'no_admin')          detail = `${v.date} — 근무자 ${v.assigned}명 중 관리자 없음`;
    else if (v.type === 'consecutive')       detail = `${esc(v.empName)} — ${v.start}부터 ${v.days}일 연속 (상한 ${v.max}일)`;
    return `<li class="viol-item viol-${v.type}">
      <span class="viol-type">${typeLabel[v.type] || v.type}</span>
      <span class="viol-detail">${detail}</span>
    </li>`;
  }).join('');

  wrapper.innerHTML = `
<div class="validation-report">
  <div class="viol-header"><span class="viol-icon">⚠</span>
    <strong>스케줄 검증 결과 — ${violations.length}건 발견</strong></div>
  <ul class="viol-list">${items}</ul>
</div>`;
}
