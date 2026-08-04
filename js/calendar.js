// calendar.js — 재사용 가능한 캘린더 UI 컴포넌트
// 휴무 신청 / 선호 근무일 지정 두 모드에서 공유 사용.
// 화면 표시만 담당. 선택 데이터는 State를 통해 저장.

import { State } from './state.js';
import { compareByRank } from './employees.js';
import {
  getDaysInMonth, isHoliday, getHolidayName, isWeekend, isRedDay,
  DAY_NAMES_KO, formatDateKo, esc,
} from './holidays.js';

/**
 * 캘린더 렌더링
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {number}  opts.year
 * @param {number}  opts.month
 * @param {string}  opts.employeeId
 * @param {'holiday'|'preferred'} opts.mode
 * @param {function} opts.onSave - 저장 완료 콜백
 */
export function renderCalendar(container, opts) {
  const { year, month, employeeId, mode, onSave } = opts;
  const employee = State.getEmployee(employeeId);
  if (!employee) return;

  // 현재 선택된 날짜들 (임시 복사본으로 조작)
  const selectedDates = new Set(
    mode === 'holiday'
      ? [...(employee.holidayRequests || [])]
      : [...(employee.preferredDates || [])]
  );

  _renderCalendarHTML(container, year, month, employee, mode, selectedDates);

  // 이벤트 리스너 중복 방지: 기존 핸들러 제거
  if (container._calHandler) {
    container.removeEventListener('click', container._calHandler);
  }

  // 이벤트 바인딩
  container._calHandler = e => {
    // 날짜 셀 클릭
    const cell = e.target.closest('.cal-day[data-date]');
    if (cell) {
      const date = cell.dataset.date;
      if (selectedDates.has(date)) {
        selectedDates.delete(date);
        cell.classList.remove('selected');
      } else {
        selectedDates.add(date);
        cell.classList.add('selected');
      }
      return;
    }

    // 저장 버튼
    if (e.target.dataset.action === 'cal-save') {
      const dateArr = [...selectedDates].sort();
      if (mode === 'holiday') {
        State.updateEmployee(employeeId, { holidayRequests: dateArr });
      } else {
        State.updateEmployee(employeeId, { preferredDates: dateArr });
      }
      showToast(`${employee.name}님의 ${mode === 'holiday' ? '휴무일' : '고정 근무일'}이 저장되었습니다.`);
      if (typeof onSave === 'function') onSave();
    }

    // 전체 선택 해제
    if (e.target.dataset.action === 'cal-clear') {
      selectedDates.clear();
      container.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
    }

    // 월 이동
    if (e.target.dataset.action === 'cal-prev') {
      let ny = year, nm = month - 1;
      if (nm < 1) { nm = 12; ny--; }
      renderCalendar(container, { ...opts, year: ny, month: nm });
    }
    if (e.target.dataset.action === 'cal-next') {
      let ny = year, nm = month + 1;
      if (nm > 12) { nm = 1; ny++; }
      renderCalendar(container, { ...opts, year: ny, month: nm });
    }
  };
  container.addEventListener('click', container._calHandler);
}

// ── 캘린더 HTML 생성 ───────────────────────────
function _renderCalendarHTML(container, year, month, employee, mode, selectedDates) {
  const modeLabel = mode === 'holiday' ? '휴무 신청일' : '고정 근무일 지정';
  const modeDesc  = mode === 'holiday'
    ? '날짜를 클릭해 휴무를 신청하거나 취소합니다.'
    : '여기 지정한 날짜는 자동 생성 시 먼저 배정됩니다.';

  const days = getDaysInMonth(year, month);
  const firstDow = new Date(`${year}-${String(month).padStart(2,'0')}-01T00:00:00`).getDay(); // 0=일
  const totalCells = Math.ceil((firstDow + days.length) / 7) * 7;

  let cellsHTML = '';
  for (let i = 0; i < totalCells; i++) {
    const dayIndex = i - firstDow;
    if (dayIndex < 0 || dayIndex >= days.length) {
      cellsHTML += `<div class="cal-day empty"></div>`;
      continue;
    }
    const dateStr = days[dayIndex];
    const d = new Date(dateStr + 'T00:00:00');
    const dayNum = d.getDate();
    const isRed = isRedDay(dateStr);
    const holiday = getHolidayName(dateStr);
    const weekend = isWeekend(dateStr);
    const isSelected = selectedDates.has(dateStr);

    const classes = [
      'cal-day',
      isRed ? 'red-day' : '',
      holiday && !weekend ? 'holiday' : '',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');

    // 공휴일이면 이름 표시, 주말은 이름 없음
    const holidayLabel = (holiday && !weekend) ? `<span class="holiday-name">${holiday}</span>` : '';

    cellsHTML += `
<div class="${classes}" data-date="${dateStr}">
  <span class="day-num">${dayNum}</span>
  ${holidayLabel}
</div>`;
  }

  container.innerHTML = `
<div class="calendar-widget">
  <div class="cal-header">
    <div class="cal-info">
      <h3>${esc(employee.name)} — ${modeLabel}</h3>
      <p class="cal-desc">${modeDesc}</p>
    </div>
    <div class="cal-nav">
      <button class="btn-icon" data-action="cal-prev">‹</button>
      <span class="cal-title">${year}년 ${month}월</span>
      <button class="btn-icon" data-action="cal-next">›</button>
    </div>
  </div>

  <div class="cal-grid">
    ${DAY_NAMES_KO.map((n, i) =>
      `<div class="cal-weekday ${i===0||i===6?'red-day':''}">${n}</div>`
    ).join('')}
    ${cellsHTML}
  </div>

  <div class="cal-legend">
    <span class="legend-dot red"></span> 공휴일/주말
    <span class="legend-dot selected"></span> 선택됨
  </div>

  <div class="cal-actions">
    <button class="btn btn-ghost" data-action="cal-clear">선택 초기화</button>
    <button class="btn btn-primary" data-action="cal-save">저장</button>
  </div>
</div>`;
}

// ── 월별 스케줄 미니 캘린더 (읽기 전용) ─────────
/**
 * 스케줄 뷰에서 사용하는 달력 (직원 태그 표시)
 * 실제 DnD 기능은 scheduleUI.js에서 처리
 */
export function renderScheduleCalendar(container, year, month, filterEmpId = null, conflicts = null) {
  const entryIssues = conflicts?.entryIssues || {};
  const dateIssues  = conflicts?.dateIssues  || {};
  const days = getDaysInMonth(year, month);
  const firstDow = new Date(`${year}-${String(month).padStart(2,'0')}-01T00:00:00`).getDay();
  const totalCells = Math.ceil((firstDow + days.length) / 7) * 7;

  let cellsHTML = '';
  for (let i = 0; i < totalCells; i++) {
    const dayIndex = i - firstDow;
    if (dayIndex < 0 || dayIndex >= days.length) {
      cellsHTML += `<div class="sch-day empty"></div>`;
      continue;
    }
    const dateStr = days[dayIndex];
    const d = new Date(dateStr + 'T00:00:00');
    const dayNum = d.getDate();
    const isRed = isRedDay(dateStr);
    const holiday = getHolidayName(dateStr);
    const weekend = isWeekend(dateStr);

    // 이 날짜의 스케줄
    // 직급 높은 순으로 정렬 (설정의 직급 목록 순서 = 서열)
    const schEntries = State.getSchedulesByDate(dateStr)
      .slice()
      .sort((a, b) => {
        const ea = State.getEmployee(a.employeeId);
        const eb = State.getEmployee(b.employeeId);
        if (!ea || !eb) return 0;
        return compareByRank(ea, eb);
      });

    const empTags = schEntries.map(s => {
      const emp = State.getEmployee(s.employeeId);
      if (!emp) return '';
      // 필터 적용 시 대상 외 직원은 회색 처리
      const dimmed = filterEmpId && emp.id !== filterEmpId;
      const hrs    = s.workingHours ?? emp.dailyWorkHours ?? 8;
      // 기본 근무시간과 다르면 강조 표시
      const custom = hrs !== (emp.dailyWorkHours ?? 8);

      // 충돌 표시 (노란색)
      const issues = entryIssues[s.id];
      const bad    = issues && issues.length > 0;
      const issueTip = bad ? issues.map(i => `⚠ ${i.label}: ${i.detail}`).join('\n') : '';

      return `<div class="emp-tag${dimmed ? ' emp-tag-dimmed' : ''}${bad ? ' tag-conflict' : ''}"
                   data-action="select-staff"
                   data-sch-id="${s.id}"
                   data-emp-id="${s.employeeId}"
                   data-date="${dateStr}"
                   title="${esc(emp.name)} · ${dateStr} · ${hrs}시간${bad ? '\n\n' + esc(issueTip) : ' (더블클릭: 시간 수정)'}"
                   style="background:${dimmed ? '#D1D5DB' : esc(emp.color)}">
                ${bad ? '<span class="tag-warn-icon">⚠</span>' : ''}
                <span class="tag-name">${esc(emp.name)}</span>
                <span class="tag-hours${custom ? ' tag-hours-custom' : ''}">${hrs}h</span>
              </div>`;
    }).join('');

    // 다음 달에 연결된 주의 날짜 → 회색 처리
    const notThisMonth = !dateStr.startsWith(`${year}-${String(month).padStart(2,'0')}`);
    const holidayLabel = (holiday && !weekend) ? `<span class="holiday-name-sm">${holiday}</span>` : '';

    // 날짜 단위 문제 (빨간색)
    const di = dateIssues[dateStr];
    let dayBadge = '', dayClass = '';
    if (di) {
      dayClass = ' day-critical';
      const parts = [];
      if (di.understaffed) parts.push(`인원 ${di.assigned}/${di.required}`);
      if (di.noAdmin)      parts.push('관리자 없음');
      dayBadge = `<span class="day-issue-badge" title="${esc(parts.join(' · '))}">${esc(parts.join(' · '))}</span>`;
    }

    cellsHTML += `
<div class="sch-day ${isRed ? 'red-day' : ''} ${notThisMonth ? 'other-month' : ''}${dayClass}"
     data-action="place-staff"
     data-date="${dateStr}">
  <div class="sch-day-header">
    <span class="day-num ${isRed ? 'red' : ''}">${dayNum}</span>
    ${holidayLabel}
    <button class="sch-add-btn" data-action="add-staff" data-date="${dateStr}" title="근무자 추가">+</button>
  </div>
  ${dayBadge}
  <div class="emp-tags" data-date="${dateStr}">${empTags}</div>
</div>`;
  }

  container.innerHTML = `
<div class="sch-cal-header">
  <button class="btn-icon" data-action="sch-prev">‹</button>
  <span class="sch-cal-title">${year}년 ${month}월</span>
  <button class="btn-icon" data-action="sch-next">›</button>
</div>
<div class="sch-grid">
  ${DAY_NAMES_KO.map((n,i)=>
    `<div class="sch-weekday ${i===0||i===6?'red-day':''}">${n}</div>`
  ).join('')}
  ${cellsHTML}
</div>`;
}

// ── 토스트 알림 (calendar.js 내부 유틸) ─────────
export function showToast(msg, type = 'success', duration = 3000) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  tc.appendChild(toast);
  setTimeout(() => { toast.classList.add('show'); }, 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
