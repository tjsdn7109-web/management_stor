// salaryCalculator.js — 급여 계산 엔진
// 순수 계산 함수만 담당. State 접근만 허용, DOM 조작 없음.

import { State } from './state.js';
import { belongsToMonth, esc } from './holidays.js';
import { getMonthlyStats, didWorkFullWeek } from './schedule.js';
import { compareByRank } from './employees.js';

const SHORT_TIME_THRESHOLD = 15; // 주 15h 미만 = 초단시간

// 급여 합계에서 임시로 제외한 직원 (세션 한정, 데이터는 그대로)
const _excluded = new Set();

// ══════════════════════════════════════════════════════
// 설정에서 보험 요율 가져오기
// ══════════════════════════════════════════════════════
function getRates() {
  return State.settings.insuranceRates || {
    nationalPension:     { employee: 4.5,  employer: 4.75  },
    healthInsurance:     { employee: 3.545, employer: 3.595 },
    longTermCareRate:    13.14,
    employmentInsurance: { employee: 0.9,  employer: 1.15  },
    industrialAccident:  { employer: 1.0  },
  };
}

// ══════════════════════════════════════════════════════
// 핵심: 직원 월 급여 계산
// ══════════════════════════════════════════════════════
export function calculateSalary(employeeId, year, month) {
  const emp = State.getEmployee(employeeId);
  if (!emp) return null;

  return emp.employmentType === 'monthly'
    ? _calcMonthlySalary(emp, year, month)
    : _calcHourlySalary(emp, year, month);
}

// ── 월급제 계산 ────────────────────────────────
function _calcMonthlySalary(emp, year, month) {
  const grossPay = emp.monthlyWage || 0;
  const insurance = _calcInsurance(grossPay, false);

  // 이달 실제 근무일 (스케줄 기준)
  const workedEntries = State.getSchedulesByEmployeeMonth(emp.id, year, month);
  const workedInMonth = workedEntries.filter(s => belongsToMonth(s.date, year, month));

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    employmentType: 'monthly',
    year, month,
    isShortTimeWorker: false,
    avgWeekHours: null,
    totalWorkDays: workedInMonth.length,
    totalWorkHours: workedInMonth.reduce((s, e) => s + (e.workingHours || 0), 0),
    basePay: grossPay,
    weeklyHolidayPay: 0,  // 월급에 포함된 것으로 간주
    grossPay,
    insurance,
    netPay: grossPay - insurance.employeeTotal,
    weekDetails: [],
  };
}

// ── 시급제/단기 계산 ───────────────────────────
function _calcHourlySalary(emp, year, month) {
  const stats = getMonthlyStats(emp.id, year, month);
  const { weeklyBreakdown, isShortTimeWorker } = stats;
  const hourlyWage = emp.hourlyWage || emp.wage || 0;  // 구버전 호환

  let basePay      = 0;
  let weeklyHolPay = 0;
  const weekDetails = [];

  for (const week of weeklyBreakdown) {
    const { weekStart, days: workDays, hours: workHours } = week;
    const weekBasePay = workHours * hourlyWage;
    basePay += weekBasePay;

    const holPay = _calcWeeklyHolidayPay(emp, weekStart, workHours, isShortTimeWorker, hourlyWage);
    weeklyHolPay += holPay;

    weekDetails.push({
      weekStart, workDays, workHours,
      isShortTime: workHours < SHORT_TIME_THRESHOLD,
      basePay: weekBasePay,
      holidayPay: holPay,
    });
  }

  const grossPay  = basePay + weeklyHolPay;
  const insurance = _calcInsurance(grossPay, isShortTimeWorker);

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    employmentType: emp.employmentType,
    year, month,
    isShortTimeWorker,
    avgWeekHours: stats.avgWeekHours,
    totalWorkDays: stats.totalDays,
    totalWorkHours: stats.totalHours,
    basePay,
    weeklyHolidayPay: weeklyHolPay,
    grossPay,
    insurance,
    netPay: grossPay - insurance.employeeTotal,
    weekDetails,
  };
}

// ── 주휴수당 ────────────────────────────────────
// 실제 근무시간(스케줄별로 개별 수정 가능) 기준으로 산정한다.
// 주휴수당 = (그 주 실근로시간 / 40) × 8 × 시급, 단 40시간 상한.
function _calcWeeklyHolidayPay(emp, weekKey, workHours, isShortTimeWorker, hourlyWage) {
  if (isShortTimeWorker || workHours < SHORT_TIME_THRESHOLD) return 0;
  if (!didWorkFullWeek(emp.id, weekKey)) return 0;
  const rate = hourlyWage || emp.hourlyWage || emp.wage || 0;
  const cappedHours = Math.min(workHours, 40);
  return Math.round((cappedHours / 40) * 8 * rate);
}

// ── 4대보험 계산 ────────────────────────────────
function _calcInsurance(grossPay, isShortTimeWorker) {
  const r = getRates();
  const pct = v => grossPay * (v / 100); // 퍼센트 → 금액

  // 국민연금 (초단시간 제외)
  const npEmp = isShortTimeWorker ? 0 : Math.round(pct(r.nationalPension.employee));
  const npEr  = isShortTimeWorker ? 0 : Math.round(pct(r.nationalPension.employer));

  // 건강보험 (초단시간 제외)
  const hiEmp = isShortTimeWorker ? 0 : Math.round(pct(r.healthInsurance.employee));
  const hiEr  = isShortTimeWorker ? 0 : Math.round(pct(r.healthInsurance.employer));

  // 장기요양보험 = 건강보험료 × longTermCareRate%
  const ltcEmp = Math.round(hiEmp * (r.longTermCareRate / 100));
  const ltcEr  = Math.round(hiEr  * (r.longTermCareRate / 100));

  // 고용보험
  const eiEmp = Math.round(pct(r.employmentInsurance.employee));
  const eiEr  = Math.round(pct(r.employmentInsurance.employer));

  // 산재보험 (사업주 전액)
  const iaEr = Math.round(pct(r.industrialAccident.employer));

  const employeeTotal = npEmp + hiEmp + ltcEmp + eiEmp;
  const employerTotal = npEr  + hiEr  + ltcEr  + eiEr  + iaEr;

  return {
    employeeTotal,
    employerTotal,
    totalCost: grossPay + employerTotal,
    breakdown: {
      nationalPension:     { employee: npEmp, employer: npEr  },
      healthInsurance:     { employee: hiEmp, employer: hiEr  },
      longTermCare:        { employee: ltcEmp, employer: ltcEr },
      employmentInsurance: { employee: eiEmp, employer: eiEr  },
      industrialAccident:  { employee: 0,      employer: iaEr  },
    },
  };
}

// ══════════════════════════════════════════════════════
// 전체 직원 일괄 계산
// ══════════════════════════════════════════════════════
export function calculateAllSalaries(year, month) {
  return State.employees
    .slice()
    .sort(compareByRank)   // 직급 높은 순
    .map(emp => calculateSalary(emp.id, year, month))
    .filter(Boolean);
}

// ══════════════════════════════════════════════════════
// 급여 탭 렌더링
// ══════════════════════════════════════════════════════
export function renderSalaryTab(container) {
  const year  = State.ui.currentYear;
  const month = State.ui.currentMonth;

  if (!State.employees.length) {
    container.innerHTML = `<div class="empty-state"><p>등록된 직원이 없습니다.</p></div>`;
    return;
  }

  // 삭제된 직원이 제외 목록에 남아 있으면 정리
  [..._excluded].forEach(id => { if (!State.getEmployee(id)) _excluded.delete(id); });

  const all      = calculateAllSalaries(year, month);
  const included = all.filter(r => !_excluded.has(r.employeeId));
  const excluded = all.filter(r =>  _excluded.has(r.employeeId));

  const sum = list => list.reduce((acc, r) => {
    acc.grossPay    += r.grossPay;
    acc.erInsurance += r.insurance.employerTotal;
    acc.totalCost   += r.insurance.totalCost;
    return acc;
  }, { grossPay: 0, erInsurance: 0, totalCost: 0 });

  const totals    = sum(included);
  const allTotals = sum(all);
  const diff      = allTotals.totalCost - totals.totalCost;

  const cards = included.length
    ? included.map(r => _renderSalaryCard(r)).join('')
    : `<div class="empty-state"><p>모든 직원이 제외되었습니다.</p></div>`;

  const excludedHTML = excluded.length ? `
<div class="excluded-panel">
  <div class="excluded-head">
    <strong>제외 ${excluded.length}명</strong>
    <span class="excluded-diff">사업주 부담 −${diff.toLocaleString()}원</span>
    <button class="btn btn-sm btn-outline" data-action="salary-restore-all">전체 복원</button>
  </div>
  <div class="excluded-list">
    ${excluded.map(r => {
      const emp = State.getEmployee(r.employeeId);
      return `<button class="excluded-chip" data-action="salary-restore" data-id="${r.employeeId}">
        <span class="emp-dot" style="background:${esc(emp?.color || '#ccc')}"></span>
        ${esc(r.employeeName)}
        <span class="chip-amount">${r.insurance.totalCost.toLocaleString()}원</span>
        <span class="chip-restore">↩ 복원</span>
      </button>`;
    }).join('')}
  </div>
</div>` : '';

  container.innerHTML = `
<div class="section-header">
  <h2>급여 계산</h2>
  <div class="salary-month-nav">
    <button class="btn btn-outline" data-action="salary-prev">‹</button>
    <span class="month-label">${year}년 ${month}월</span>
    <button class="btn btn-outline" data-action="salary-next">›</button>
  </div>
</div>

<div class="salary-summary-bar">
  <div class="summary-item">
    <span class="sum-label">세전 총 급여</span>
    <span class="sum-value">${totals.grossPay.toLocaleString()}원</span>
  </div>
  <div class="summary-item">
    <span class="sum-label">사업주 보험 부담</span>
    <span class="sum-value">${totals.erInsurance.toLocaleString()}원</span>
  </div>
  <div class="summary-item">
    <span class="sum-label">사업주 총 부담</span>
    <span class="sum-value highlight">${totals.totalCost.toLocaleString()}원</span>
  </div>
  ${excluded.length ? `
  <div class="summary-item summary-excluded">
    <span class="sum-label">제외 ${excluded.length}명 포함 시</span>
    <span class="sum-value muted">${allTotals.totalCost.toLocaleString()}원</span>
  </div>` : ''}
</div>

${excludedHTML}

<p class="salary-hint">제외 버튼으로 특정 직원을 빼고 합계를 볼 수 있습니다. 데이터는 그대로입니다.</p>

<div class="salary-cards">${cards}</div>`;

  // 이벤트 (중복 방지)
  if (container._salaryHandler) container.removeEventListener('click', container._salaryHandler);
  container._salaryHandler = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'salary-prev') {
      let { currentYear: y, currentMonth: m } = State.ui;
      if (--m < 1) { m = 12; y--; }
      State.ui.currentYear = y; State.ui.currentMonth = m;
      renderSalaryTab(container);

    } else if (action === 'salary-next') {
      let { currentYear: y, currentMonth: m } = State.ui;
      if (++m > 12) { m = 1; y++; }
      State.ui.currentYear = y; State.ui.currentMonth = m;
      renderSalaryTab(container);

    } else if (action === 'salary-exclude') {
      _excluded.add(btn.dataset.id);
      renderSalaryTab(container);

    } else if (action === 'salary-restore') {
      _excluded.delete(btn.dataset.id);
      renderSalaryTab(container);

    } else if (action === 'salary-restore-all') {
      _excluded.clear();
      renderSalaryTab(container);
    }
  };
  container.addEventListener('click', container._salaryHandler);
}

// ── 카드 HTML ─────────────────────────────────
function _renderSalaryCard(r) {
  const emp      = State.getEmployee(r.employeeId);
  const color    = emp?.color || '#ccc';
  const typeMap  = { hourly: '시급제', monthly: '월급제', shortTerm: '단기' };
  const typeLabel = typeMap[r.employmentType] || r.employmentType;
  const isMonthly = r.employmentType === 'monthly';

  return `
<div class="salary-card ${r.isShortTimeWorker ? 'short-time' : ''}">
  <div class="salary-card-header">
    <span class="emp-dot" style="background:${esc(color)}"></span>
    <strong>${esc(r.employeeName)}</strong>
    <span class="badge ${isMonthly ? 'badge-monthly' : 'badge-hourly'}">${typeLabel}</span>
    ${r.isShortTimeWorker ? '<span class="badge badge-warn">초단시간</span>' : ''}
    <span class="salary-meta">${r.totalWorkDays}일 / ${r.totalWorkHours}h 근무</span>
    <button class="btn btn-xs btn-exclude" data-action="salary-exclude" data-id="${r.employeeId}"
            title="합계에서 임시로 제외">제외</button>
  </div>

  <div class="salary-breakdown">
    <div class="salary-row">
      <span>${isMonthly ? '월 고정급' : '기본급'}</span>
      <span>${r.basePay.toLocaleString()}원</span>
    </div>
    ${!isMonthly ? `
    <div class="salary-row">
      <span>주휴수당</span>
      <span>${r.weeklyHolidayPay.toLocaleString()}원</span>
    </div>` : ''}
    <div class="salary-row total">
      <span>세전 급여</span>
      <span>${r.grossPay.toLocaleString()}원</span>
    </div>
    <div class="salary-row deduct">
      <span>근로자 부담 4대보험</span>
      <span>− ${r.insurance.employeeTotal.toLocaleString()}원</span>
    </div>
    <div class="salary-row net">
      <span>실수령액</span>
      <span>${r.netPay.toLocaleString()}원</span>
    </div>
    <div class="salary-row employer">
      <span>사업주 부담 4대보험</span>
      <span>${r.insurance.employerTotal.toLocaleString()}원</span>
    </div>
    <div class="salary-row total-cost">
      <span>사업주 총 부담</span>
      <span>${r.insurance.totalCost.toLocaleString()}원</span>
    </div>
  </div>

  <details class="insurance-detail">
    <summary>보험 상세</summary>
    ${_renderInsuranceDetail(r.insurance.breakdown)}
  </details>
</div>`;
}

// ── 보험 상세 테이블 ───────────────────────────
function _renderInsuranceDetail(bd) {
  const r = getRates();
  const labels = {
    nationalPension:     `국민연금 (근로자 ${r.nationalPension.employee}% / 사업주 ${r.nationalPension.employer}%)`,
    healthInsurance:     `건강보험 (근로자 ${r.healthInsurance.employee}% / 사업주 ${r.healthInsurance.employer}%)`,
    longTermCare:        `장기요양보험 (건강보험료 × ${r.longTermCareRate}%)`,
    employmentInsurance: `고용보험 (근로자 ${r.employmentInsurance.employee}% / 사업주 ${r.employmentInsurance.employer}%)`,
    industrialAccident:  `산재보험 (사업주 ${r.industrialAccident.employer}% 전액)`,
  };
  return `<table class="ins-table">
    <thead><tr><th>항목</th><th>근로자</th><th>사업주</th></tr></thead>
    <tbody>
      ${Object.entries(bd).map(([key, val]) => `
        <tr>
          <td>${labels[key] || key}</td>
          <td>${val.employee.toLocaleString()}원</td>
          <td>${val.employer.toLocaleString()}원</td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}
