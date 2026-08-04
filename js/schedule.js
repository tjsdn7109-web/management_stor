// schedule.js — 스케줄 자동 생성 엔진 (랜덤 최적화 버전)
// 100~200회 반복 생성 후 최고 점수 스케줄 채택

import { State } from './state.js';
import { getDaysInMonth, getWeekKey, belongsToMonth } from './holidays.js';

// ══════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════

/** 직급이 관리자인지 확인 */
function _isAdmin(emp) {
  const positions = State.settings.positions || [];
  const found = positions.find(p => p.name === emp.position);
  return found ? found.isAdmin : false;
}

/** 가중치 기반 랜덤 선택 */
function _weightedRandom(candidates, weightFn) {
  const weights = candidates.map(c => Math.max(0.01, weightFn(c)));
  const total   = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ══════════════════════════════════════════════════════
// 상태 추적
// ══════════════════════════════════════════════════════
/**
 * 상태 초기화 — 이전 달 말미 근무 이력을 이어받아
 * 월 경계에서 연속근무·주간한도가 끊기지 않도록 시드한다.
 * @param {string[]} days  이번 달 날짜 배열 (오름차순)
 */
function _initStatus(days) {
  const map = {};
  const firstDate = days[0];
  const firstWk   = getWeekKey(firstDate);
  const firstMs   = new Date(firstDate + 'T00:00:00').getTime();

  for (const emp of State.employees) {
    const st = {
      monthDays: 0,
      weeklyDays: {},   // weekKey → count
      weeklyHours: {},  // weekKey → hours
      consecutiveDays: 0,
      lastDate: null,
      dowCount: {},     // dow(0-6) → count (요일 편향 추적)
      weekendCount: 0,  // 주말(토·일) 배정 횟수 — 공정성 추적
    };

    // ── 이전 달 이력 시드 ──
    // 이번 달 시작 이전 14일 범위의 기존 스케줄을 조회
    const prior = State.schedules
      .filter(s => s.employeeId === emp.id)
      .filter(s => {
        const ms = new Date(s.date + 'T00:00:00').getTime();
        return ms < firstMs && ms >= firstMs - 14 * 86400000;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    if (prior.length) {
      // ① 첫 주가 이전 달과 겹치는 경우, 그 주의 근무일/시간을 이월
      for (const s of prior) {
        if (getWeekKey(s.date) === firstWk) {
          st.weeklyDays[firstWk]  = (st.weeklyDays[firstWk]  || 0) + 1;
          st.weeklyHours[firstWk] = (st.weeklyHours[firstWk] || 0) + (s.workingHours || 0);
        }
      }

      // ② 직전일부터 거슬러 올라가며 연속근무 일수 계산
      const dates = new Set(prior.map(s => s.date));
      let cursor = new Date(firstMs - 86400000);
      let streak = 0;
      while (streak < 14) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
        if (!dates.has(key)) break;
        streak++;
        cursor = new Date(cursor.getTime() - 86400000);
      }
      if (streak > 0) {
        st.consecutiveDays = streak;
        const d = new Date(firstMs - 86400000);
        st.lastDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
    }

    map[emp.id] = st;
  }
  return map;
}

function _updateStatus(map, empId, dateStr, hours) {
  const s   = map[empId];
  if (!s) return;
  const wk  = getWeekKey(dateStr);
  const dow = new Date(dateStr + 'T00:00:00').getDay();

  s.monthDays++;
  s.weeklyDays[wk]  = (s.weeklyDays[wk]  || 0) + 1;
  s.weeklyHours[wk] = (s.weeklyHours[wk] || 0) + hours;
  s.dowCount[dow]   = (s.dowCount[dow]   || 0) + 1;
  if (dow === 0 || dow === 6) s.weekendCount++;  // 주말 공정성 추적

  s.consecutiveDays = _projectedConsecutive(map, empId, dateStr);
  s.lastDate = dateStr;
}

/** 이 날짜에 배정한다면 연속근무가 며칠째가 되는지 */
function _projectedConsecutive(status, empId, dateStr) {
  const s = status[empId];
  if (!s || !s.lastDate) return 1;
  const diff = Math.round(
    (new Date(dateStr + 'T00:00:00') - new Date(s.lastDate + 'T00:00:00')) / 86400000
  );
  return diff === 1 ? s.consecutiveDays + 1 : 1;
}

/** 실효 주 최대 근무일 = min(최대 근무일, 7 − 최소 휴무일) */
function _effMaxDays(emp) {
  const byMax  = emp.maxWorkDaysPerWeek || 6;
  const byRest = 7 - (emp.minRestDaysPerWeek ?? 1);
  return Math.max(1, Math.min(byMax, byRest));
}

/** 상근 관리자: 관리자이면서 주 7일 근무 설정 */
function _isFullTimeAdmin(emp) {
  return _isAdmin(emp) && (emp.maxWorkDaysPerWeek || 0) >= 7;
}

function _canAssign(emp, dateStr, weekKey, status, maxWeekHours) {
  if ((emp.holidayRequests || []).includes(dateStr)) return false;

  // 상근 관리자(주 7일)는 휴무일수·연속근무 제약에서 제외
  if (_isFullTimeAdmin(emp)) return true;

  const s = status[emp.id] || { weeklyDays: {}, weeklyHours: {} };
  if ((s.weeklyDays[weekKey] || 0)  >= _effMaxDays(emp)) return false;
  if ((s.weeklyHours[weekKey] || 0) + emp.dailyWorkHours > maxWeekHours) return false;

  // 연속근무 상한 — 하드 제약
  const maxConsec = emp.maxConsecutiveDays || 5;
  if (_projectedConsecutive(status, emp.id, dateStr) > maxConsec) return false;

  return true;
}

// ══════════════════════════════════════════════════════
// 단일 시도 (1회 스케줄 생성)
// ══════════════════════════════════════════════════════
function _generateTrial(year, month, days, operatingDays, requiredByDay, maxWeekHours) {
  const result  = [];   // { date, employeeId, workingHours }
  const status  = _initStatus(days);  // 이전 달 이력 시드 포함

  // 날짜별 배정된 empId 집합 (중복 방지)
  const dayAssigned = {};

  for (const dateStr of days) {
    const dow     = new Date(dateStr + 'T00:00:00').getDay();
    if (!operatingDays.includes(dow)) continue;
    const weekKey = getWeekKey(dateStr);
    const required = requiredByDay[dow] ?? 2;

    dayAssigned[dateStr] = new Set();

    const assign = emp => {
      result.push({ date: dateStr, employeeId: emp.id, workingHours: emp.dailyWorkHours });
      _updateStatus(status, emp.id, dateStr, emp.dailyWorkHours);
      dayAssigned[dateStr].add(emp.id);
    };

    // ── PASS 0: 상근 관리자(주 7일) 무조건 배정 ──
    // 주 최대 근무일이 7일인 관리자는 영업일 전체에 배정한다.
    for (const emp of State.employees) {
      if (!_isAdmin(emp)) continue;
      if ((emp.maxWorkDaysPerWeek || 0) < 7) continue;
      if (dayAssigned[dateStr].has(emp.id)) continue;
      if ((emp.holidayRequests || []).includes(dateStr)) continue; // 휴무 신청만 예외
      assign(emp);
    }

    // ── PASS 1: 고정 근무일 배정 ──────────────
    for (const emp of State.employees) {
      if (dayAssigned[dateStr].size >= required && !_isAdmin(emp)) break;
      if (!(emp.preferredDates || []).includes(dateStr)) continue;
      if (dayAssigned[dateStr].has(emp.id)) continue;
      if (!_canAssign(emp, dateStr, weekKey, status, maxWeekHours)) continue;
      assign(emp);
    }

    // ── PASS 1.5: 관리자 1명 확보 (필요인원과 무관하게 반드시) ──
    const hasAdminNow = () =>
      [...dayAssigned[dateStr]].some(id => _isAdmin(State.getEmployee(id) || {}));

    if (!hasAdminNow()) {
      // ① 정상 제약을 모두 만족하는 관리자
      let pool = State.employees.filter(emp =>
        _isAdmin(emp) &&
        !dayAssigned[dateStr].has(emp.id) &&
        emp.availableWorkDays.includes(dow) &&
        _canAssign(emp, dateStr, weekKey, status, maxWeekHours)
      );

      // ② 없으면 근무 가능요일 제약을 완화 (관리자는 요일 예외 허용)
      if (!pool.length) {
        pool = State.employees.filter(emp =>
          _isAdmin(emp) &&
          !dayAssigned[dateStr].has(emp.id) &&
          _canAssign(emp, dateStr, weekKey, status, maxWeekHours)
        );
      }

      // ③ 그래도 없으면 휴무 신청일만 지키고 강제 배정
      //    (관리자 부재보다 한도 초과가 낫다는 운영 판단)
      if (!pool.length) {
        pool = State.employees.filter(emp =>
          _isAdmin(emp) &&
          !dayAssigned[dateStr].has(emp.id) &&
          !(emp.holidayRequests || []).includes(dateStr)
        );
      }

      if (pool.length) {
        assign(_weightedRandom(pool, emp => _calcWeight(emp, dateStr, weekKey, dow, status)));
      }
    }

    if (dayAssigned[dateStr].size >= required) continue;

    // ── PASS 2: 관리자 우선 (가중치 랜덤) ────
    const admins = State.employees.filter(emp =>
      _isAdmin(emp) &&
      !dayAssigned[dateStr].has(emp.id) &&
      emp.availableWorkDays.includes(dow) &&
      _canAssign(emp, dateStr, weekKey, status, maxWeekHours)
    );

    while (admins.length && dayAssigned[dateStr].size < required) {
      const emp = _weightedRandom(admins, emp => _calcWeight(emp, dateStr, weekKey, dow, status));
      admins.splice(admins.indexOf(emp), 1);
      assign(emp);
    }

    if (dayAssigned[dateStr].size >= required) continue;

    // ── PASS 3: 일반직 가중치 랜덤 ───────────
    let general = State.employees.filter(emp =>
      !_isAdmin(emp) &&
      !dayAssigned[dateStr].has(emp.id) &&
      emp.availableWorkDays.includes(dow) &&
      _canAssign(emp, dateStr, weekKey, status, maxWeekHours)
    );

    while (general.length && dayAssigned[dateStr].size < required) {
      const emp = _weightedRandom(general, emp => _calcWeight(emp, dateStr, weekKey, dow, status));
      general = general.filter(e => e.id !== emp.id);
      assign(emp);
    }
  }

  return result;
}

/** 배정 가중치: 높을수록 이 날 배정될 확률 높음 */
function _calcWeight(emp, dateStr, weekKey, dow, status) {
  const s = status[emp.id];
  if (!s) return 1;

  const target    = emp.targetWorkDaysPerWeek || emp.maxWorkDaysPerWeek || 5;
  const weekDays  = s.weeklyDays[weekKey]  || 0;
  const weekHours = s.weeklyHours[weekKey] || 0;
  const dowCnt    = s.dowCount[dow]        || 0;   // 요일 편향
  const isWknd    = (dow === 0 || dow === 6);

  // 주 목표 대비 부족 → 높을수록 우선
  const shortfall    = Math.max(0, target - weekDays) * 8;
  // 연속 근무 패널티 (배정 시 며칠째가 되는지 기준)
  const projConsec   = _projectedConsecutive(status, emp.id, dateStr);
  const consPenalty  = projConsec <= 2 ? projConsec : projConsec * 5;
  // 주 시간 패널티
  const hoursPenalty = weekHours * 0.2;
  // 요일 편향 패널티 (같은 요일 반복 배정 억제)
  const dowPenalty   = dowCnt >= 2 ? (dowCnt - 1) * 4 : 0;

  // 주말 공정성 — 관리자는 상시 근무가 전제이므로 제외
  // 이미 주말을 많이 선 일반직은 다음 주말 배정 확률을 낮춤
  const wkndPenalty  = (isWknd && !_isAdmin(emp)) ? s.weekendCount * 6 : 0;

  return Math.max(0.01,
    shortfall - consPenalty - hoursPenalty - dowPenalty - wkndPenalty + 5);
}

// ══════════════════════════════════════════════════════
// 스케줄 평가 (점수 계산)
// ══════════════════════════════════════════════════════
function _scoreTrialResult(trialResult, days, operatingDays, requiredByDay, maxWeekHours) {
  let score = 0;

  // ① 인원 충족 점수 + 관리자 배치 점수
  for (const dateStr of days) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (!operatingDays.includes(dow)) continue;
    const required = requiredByDay[dow] ?? 2;
    const dayList  = trialResult.filter(s => s.date === dateStr);
    const count    = dayList.length;
    const coverage = Math.min(count, required);
    score += coverage * 15;
    score -= Math.max(0, required - count) * 40; // 인원 부족 패널티

    // 관리자 1명 이상 필수 — 미배치 시 강한 패널티
    if (count > 0 && !dayList.some(s => _isAdmin(State.getEmployee(s.employeeId) || {}))) {
      score -= 50;
    }
  }

  // ② 직원별 주간 위반 패널티
  const empWeekData = {};
  for (const s of trialResult) {
    const emp = State.getEmployee(s.employeeId);
    if (!emp) continue;
    const wk = getWeekKey(s.date);
    if (!empWeekData[emp.id]) empWeekData[emp.id] = {};
    if (!empWeekData[emp.id][wk]) empWeekData[emp.id][wk] = { days: 0, hours: 0 };
    empWeekData[emp.id][wk].days  += 1;
    empWeekData[emp.id][wk].hours += s.workingHours || 0;
  }

  for (const [empId, weeks] of Object.entries(empWeekData)) {
    const emp = State.getEmployee(empId);
    if (!emp) continue;
    for (const { days, hours } of Object.values(weeks)) {
      if (hours > maxWeekHours)          score -= 30;
      if (days  > emp.maxWorkDaysPerWeek) score -= 20;
    }
  }

  // ③ 요일 편향 패널티 (직원이 특정 요일에만 집중 배정)
  const empDowData = {};
  for (const s of trialResult) {
    const dow = new Date(s.date + 'T00:00:00').getDay();
    if (!empDowData[s.employeeId]) empDowData[s.employeeId] = {};
    empDowData[s.employeeId][dow] = (empDowData[s.employeeId][dow] || 0) + 1;
  }
  for (const dowMap of Object.values(empDowData)) {
    for (const cnt of Object.values(dowMap)) {
      if (cnt >= 3) score -= (cnt - 2) * 6; // 같은 요일 3회+ 배정 패널티
    }
  }

  // ④ 주말 근무 공정성 — 관리자 제외한 일반직끼리 균등해야 함
  const nonAdmins = State.employees.filter(e => !_isAdmin(e));
  if (nonAdmins.length > 1) {
    const wkndCount = {};
    nonAdmins.forEach(e => { wkndCount[e.id] = 0; });
    for (const s of trialResult) {
      if (!(s.employeeId in wkndCount)) continue;
      const dow = new Date(s.date + 'T00:00:00').getDay();
      if (dow === 0 || dow === 6) wkndCount[s.employeeId]++;
    }
    const vals = Object.values(wkndCount);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // 분산이 클수록(특정인에게 주말이 몰릴수록) 패널티
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    score -= variance * 8;
  }

  // ⑤ 연속근무 상한 위반 패널티 (하드 제약이지만 안전망)
  const byEmp = {};
  for (const s of trialResult) (byEmp[s.employeeId] ??= []).push(s.date);
  for (const [empId, dates] of Object.entries(byEmp)) {
    const emp = State.getEmployee(empId);
    if (!emp) continue;
    const limit = emp.maxConsecutiveDays || 5;
    dates.sort();
    let run = 1;
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round(
        (new Date(dates[i] + 'T00:00:00') - new Date(dates[i-1] + 'T00:00:00')) / 86400000
      );
      run = diff === 1 ? run + 1 : 1;
      if (run > limit) score -= 25;
    }
  }

  return score;
}

// ══════════════════════════════════════════════════════
// 메인: 스케줄 자동 생성
// ══════════════════════════════════════════════════════
/**
 * 스케줄 자동 생성 (비동기 — 진행률 콜백 지원)
 * @param {number} year
 * @param {number} month
 * @param {object} opts
 * @param {boolean}  opts.clearFirst
 * @param {function} opts.onProgress  (done, total, bestScore) => void
 */
export async function generateSchedule(year, month, opts = {}) {
  const {
    clearFirst = true,
    onProgress = null,
    // 이번 생성에만 적용할 임시 설정 (없으면 저장된 설정 사용)
    requiredByDay: reqOverride = null,
    operatingDays: opOverride  = null,
  } = opts;

  const operatingDays = opOverride  || State.settings.storeOperatingDays;
  const requiredByDay = reqOverride || State.settings.requiredStaffByDay || {};
  const maxWeekHours  = State.settings.weeklyMaximumHours;
  const days          = getDaysInMonth(year, month);

  // 반복 횟수: 100~200회 랜덤
  const iterations = Math.floor(Math.random() * 101) + 100; // 100~200
  const CHUNK      = 10; // 청크마다 UI에 제어권 양보

  let bestResult = null;
  let bestScore  = -Infinity;

  for (let i = 0; i < iterations; i++) {
    const trial = _generateTrial(year, month, days, operatingDays, requiredByDay, maxWeekHours);
    const score = _scoreTrialResult(trial, days, operatingDays, requiredByDay, maxWeekHours);
    if (score > bestScore) {
      bestScore  = score;
      bestResult = trial;
    }

    // 진행률 보고 + 렌더링 기회 제공
    if (onProgress && ((i + 1) % CHUNK === 0 || i === iterations - 1)) {
      onProgress(i + 1, iterations, Math.round(bestScore));
      await new Promise(r => requestAnimationFrame(() => r()));
    }
  }

  // 기존 해당 월 스케줄 교체
  if (clearFirst) State.clearSchedulesByMonth(year, month);

  let added = 0;
  for (const entry of (bestResult || [])) {
    const ok = State.addSchedule(entry);
    if (ok) added++;
  }

  // 검증
  const violations = _runValidation(year, month);
  const errors     = violations
    .filter(v => v.type === 'understaffed')
    .map(v => `인원 부족: ${v.date} (${v.assigned}/${v.required}명)`);

  return {
    added,
    skipped: (bestResult?.length || 0) - added,
    errors,
    violations,
    fixedCount: 0,
    iterations,
    bestScore: Math.round(bestScore),
  };
}

// ══════════════════════════════════════════════════════
// 검증
// ══════════════════════════════════════════════════════
export function validateSchedule(year, month) {
  return _runValidation(year, month);
}

/**
 * 달력 표시용 충돌 감지
 * - entryIssues: 개별 근무(스케줄 ID) 단위 문제 → 노란색
 * - dateIssues : 날짜 단위 문제(인원 부족·관리자 없음) → 빨간색
 * @returns {{ entryIssues: Object, dateIssues: Object, entryCount: number, dateCount: number }}
 */
export function detectScheduleConflicts(year, month) {
  const entryIssues = {};   // schId  → [{ label, detail }]
  const dateIssues  = {};   // dateStr → { understaffed?, noAdmin?, required, assigned }

  // 아직 스케줄이 없으면(생성 전) 경고하지 않는다
  if (State.getSchedulesByMonth(year, month).length === 0) {
    return { entryIssues, dateIssues, entryCount: 0, dateCount: 0, empty: true };
  }

  const operatingDays = State.settings.storeOperatingDays;
  const requiredByDay = State.settings.requiredStaffByDay || {};
  const maxWeekHours  = State.settings.weeklyMaximumHours;
  const days          = getDaysInMonth(year, month);
  const dayNames      = ['일','월','화','수','목','금','토'];

  const addEntry = (schId, label, detail) => {
    (entryIssues[schId] ??= []).push({ label, detail });
  };

  // ── ① 개별 근무 단위 검사 ──
  for (const dateStr of days) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    for (const s of State.getSchedulesByDate(dateStr)) {
      const emp = State.getEmployee(s.employeeId);
      if (!emp) { addEntry(s.id, '삭제된 직원', '직원 정보가 없습니다.'); continue; }

      // 휴무 신청일은 상근 관리자에게도 적용
      if ((emp.holidayRequests || []).includes(dateStr))
        addEntry(s.id, '휴무 신청일', `${emp.name}님이 휴무로 신청한 날입니다.`);

      if (_isFullTimeAdmin(emp)) continue; // 나머지 제약 면제

      if (!(emp.availableWorkDays || []).includes(dow))
        addEntry(s.id, '근무 가능요일 아님',
          `${dayNames[dow]}요일은 ${emp.name}님의 근무 가능요일이 아닙니다.`);
    }
  }

  // ── ② 주 단위 검사 (주 최대일 · 52시간) ──
  for (const emp of State.employees) {
    if (_isFullTimeAdmin(emp)) continue;
    const effMax = _effMaxDays(emp);
    const byWeek = {};

    for (const s of State.getSchedulesByEmployee(emp.id)) {
      if (!belongsToMonth(s.date, year, month)) continue;
      const wk = getWeekKey(s.date);
      (byWeek[wk] ??= []).push(s);
    }

    for (const [wk, list] of Object.entries(byWeek)) {
      // 그 주 전체(다른 달 포함) 기준으로 집계
      const allInWeek = State.getWeeklySchedules(emp.id, wk);
      const dayCnt = allInWeek.length;
      const hourSum = allInWeek.reduce((a, s) => a + (s.workingHours || 0), 0);

      if (dayCnt > effMax) {
        const rest = emp.minRestDaysPerWeek ?? 1;
        list.forEach(s => addEntry(s.id, '주 최대 근무일 초과',
          `${wk} 주 ${dayCnt}일 근무 (상한 ${effMax}일 · 휴무 ${rest}일 보장).`));
      }
      if (hourSum > maxWeekHours) {
        list.forEach(s => addEntry(s.id, `주 ${maxWeekHours}시간 초과`,
          `${wk} 주 합계 ${hourSum}시간.`));
      }
    }

    // ── ③ 연속근무 상한 ──
    const limit = emp.maxConsecutiveDays || 5;
    const sorted = State.getSchedulesByEmployee(emp.id).slice().sort((a, b) => a.date.localeCompare(b.date));
    let run = [];
    const flush = () => {
      if (run.length > limit) {
        run.filter(s => belongsToMonth(s.date, year, month))
           .forEach(s => addEntry(s.id, '연속근무 상한 초과',
             `${run[0].date}부터 ${run.length}일 연속 (상한 ${limit}일).`));
      }
      run = [];
    };
    for (const s of sorted) {
      if (!run.length) { run = [s]; continue; }
      const diff = Math.round(
        (new Date(s.date + 'T00:00:00') - new Date(run[run.length-1].date + 'T00:00:00')) / 86400000
      );
      if (diff === 1) run.push(s);
      else { flush(); run = [s]; }
    }
    flush();
  }

  // ── ④ 날짜 단위 검사 (인원 부족 · 관리자 없음) ──
  for (const dateStr of days) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (!operatingDays.includes(dow)) continue;
    const required  = requiredByDay[dow] ?? 2;
    const dayScheds = State.getSchedulesByDate(dateStr);

    const understaffed = dayScheds.length < required;
    const noAdmin = dayScheds.length > 0 &&
      !dayScheds.some(s => _isAdmin(State.getEmployee(s.employeeId) || {}));

    if (understaffed || noAdmin) {
      dateIssues[dateStr] = {
        understaffed, noAdmin,
        required, assigned: dayScheds.length,
      };
    }
  }

  return {
    entryIssues,
    dateIssues,
    entryCount: Object.keys(entryIssues).length,
    dateCount:  Object.keys(dateIssues).length,
    empty: false,
  };
}

function _runValidation(year, month) {
  const violations    = [];
  const operatingDays = State.settings.storeOperatingDays;
  const requiredByDay = State.settings.requiredStaffByDay || {};
  const maxWeekHours  = State.settings.weeklyMaximumHours;
  const days          = getDaysInMonth(year, month);

  // ① 중복 배치
  const seen = new Set();
  for (const s of State.schedules) {
    if (!belongsToMonth(s.date, year, month)) continue;
    const key = `${s.date}|${s.employeeId}`;
    if (seen.has(key)) {
      violations.push({ type: 'duplicate', date: s.date,
        empName: State.getEmployee(s.employeeId)?.name || '?', scheduleId: s.id });
    }
    seen.add(key);
  }

  for (const dateStr of days) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (!operatingDays.includes(dow)) continue;
    const required  = requiredByDay[dow] ?? 2;
    const dayScheds = State.getSchedulesByDate(dateStr)
      .filter(s => belongsToMonth(s.date, year, month));

    // ② 인원 부족
    if (dayScheds.length < required) {
      violations.push({ type: 'understaffed', date: dateStr, required, assigned: dayScheds.length });
    }

    // ③ 휴무일 근무
    for (const s of dayScheds) {
      const emp = State.getEmployee(s.employeeId);
      if (emp && (emp.holidayRequests || []).includes(dateStr)) {
        violations.push({ type: 'holiday_violation', date: dateStr, empName: emp.name, scheduleId: s.id });
      }
    }

    // ④ 관리자 미배치 (근무자가 1명 이상 있는데 관리자가 없는 경우)
    if (dayScheds.length > 0 && !dayScheds.some(s => _isAdmin(State.getEmployee(s.employeeId) || {}))) {
      violations.push({ type: 'no_admin', date: dateStr, assigned: dayScheds.length });
    }
  }

  // ④ 주 초과
  for (const emp of State.employees) {
    const empScheds = State.getSchedulesByEmployeeMonth(emp.id, year, month)
      .filter(s => belongsToMonth(s.date, year, month));

    const wkHours = {}, wkDays = {};
    empScheds.forEach(s => {
      const wk = getWeekKey(s.date);
      wkHours[wk] = (wkHours[wk] || 0) + (s.workingHours || 0);
      wkDays[wk]  = (wkDays[wk]  || 0) + 1;
    });

    for (const [wk, hrs] of Object.entries(wkHours)) {
      if (hrs > maxWeekHours)
        violations.push({ type: 'overtime', empName: emp.name, empId: emp.id, weekKey: wk, hours: hrs, limit: maxWeekHours });
    }
    const effMax = _effMaxDays(emp);
    for (const [wk, d] of Object.entries(wkDays)) {
      if (!_isFullTimeAdmin(emp) && d > effMax)
        violations.push({ type: 'max_days', empName: emp.name, empId: emp.id, weekKey: wk, days: d, max: effMax });
    }

    // ⑤ 연속근무 상한 초과 (이전 달 말미까지 이어서 판정)
    if (_isFullTimeAdmin(emp)) continue; // 상근 관리자는 연속근무 검증 제외
    const limit = emp.maxConsecutiveDays || 5;
    const allDates = State.getSchedulesByEmployee(emp.id).map(s => s.date).sort();
    let run = 1, runStart = allDates[0];
    for (let i = 1; i < allDates.length; i++) {
      const diff = Math.round(
        (new Date(allDates[i] + 'T00:00:00') - new Date(allDates[i-1] + 'T00:00:00')) / 86400000
      );
      if (diff === 1) {
        run++;
        // 연속 구간이 이번 달에 걸쳐 있고 상한을 막 초과한 시점에 1건만 보고
        if (run === limit + 1 && belongsToMonth(allDates[i], year, month)) {
          violations.push({
            type: 'consecutive', empName: emp.name, empId: emp.id,
            date: allDates[i], start: runStart, days: run, max: limit,
          });
        }
      } else {
        run = 1; runStart = allDates[i];
      }
    }
  }

  return violations;
}

// ══════════════════════════════════════════════════════
// 이동 / 교환
// ══════════════════════════════════════════════════════

/**
 * 스케줄 이동
 * @param {string} scheduleId
 * @param {string} newDate
 * @param {{ force?: boolean }} opts  force=true → 52h 초과 무시하고 이동
 */
export function moveSchedule(scheduleId, newDate, opts = {}) {
  const { force = false } = opts;
  const entry = State.schedules.find(s => s.id === scheduleId);
  if (!entry) return { ok: false, reason: '스케줄을 찾을 수 없습니다.' };
  const emp = State.getEmployee(entry.employeeId);
  if (!emp) return { ok: false, reason: '직원 정보를 찾을 수 없습니다.' };

  const dow = new Date(newDate + 'T00:00:00').getDay();
  if (!emp.availableWorkDays.includes(dow))
    return { ok: false, reason: `${emp.name}님은 해당 요일 근무 불가합니다.` };

  // 이동 후 상태 계산 (해당 스케줄 제외)
  const temp = State.schedules.filter(s => s.id !== scheduleId);
  const wt   = {};
  temp.forEach(s => {
    const wk = getWeekKey(s.date);
    if (!wt[s.employeeId]) wt[s.employeeId] = {};
    if (!wt[s.employeeId][wk]) wt[s.employeeId][wk] = { hours: 0, days: 0 };
    wt[s.employeeId][wk].hours += s.workingHours || 0;
    wt[s.employeeId][wk].days  += 1;
  });

  const weekKey    = getWeekKey(newDate);
  const maxHours   = State.settings.weeklyMaximumHours;
  const track      = wt?.[emp.id]?.[weekKey] || { hours: 0, days: 0 };
  // 이동할 근무의 실제 시간 (schedule에 기록된 값 우선, 없으면 직원 기본값)
  const moveHours  = entry.workingHours || emp.dailyWorkHours || 8;

  // 중복 배정 및 휴무 체크 (force와 무관)
  if ((emp.holidayRequests || []).includes(newDate))
    return { ok: false, reason: `${emp.name}님의 휴무 신청일입니다.` };
  if (temp.some(s => s.date === newDate && s.employeeId === emp.id))
    return { ok: false, reason: `${emp.name}님은 해당 날짜에 이미 배정되어 있습니다.` };

  // 상근 관리자(주 7일)는 근무일수·연속근무 제약 면제
  if (!_isFullTimeAdmin(emp)) {
    const effMax = _effMaxDays(emp);
    if (track.days >= effMax) {
      const rest = emp.minRestDaysPerWeek ?? 1;
      return { ok: false,
        reason: `${emp.name}님의 주 최대 근무일(${effMax}일, 휴무 ${rest}일 보장)을 초과합니다.` };
    }
    const consecLimit = emp.maxConsecutiveDays || 5;
    const consec = countConsecutiveIfAdded(emp.id, newDate, [scheduleId]);
    if (consec > consecLimit)
      return { ok: false, reason: `${emp.name}님의 연속근무 상한(${consecLimit}일)을 초과합니다. (${consec}일 연속)` };
  }

  // 52h 초과 체크 — force=false 이면 항상 차단 (경고용 플래그 반환)
  if (!force && track.hours + moveHours > maxHours)
    return {
      ok: false,
      overtime: true,
      reason: `${emp.name}님의 이번 주 근무시간이 ${maxHours}시간을 초과합니다.\n현재 ${track.hours}h + 이동 ${moveHours}h = ${track.hours + moveHours}h`,
    };

  State.updateSchedule(scheduleId, { date: newDate });
  return { ok: true };
}

/**
 * 두 스케줄의 날짜를 교환
 * @param {string} schId1  @param {string} date1
 * @param {string} schId2  @param {string} date2
 */
export function swapSchedules(schId1, date1, schId2, date2) {
  const s1 = State.schedules.find(s => s.id === schId1);
  const s2 = State.schedules.find(s => s.id === schId2);
  if (!s1 || !s2) return { ok: false, reason: '스케줄을 찾을 수 없습니다.' };

  const emp1 = State.getEmployee(s1.employeeId);
  const emp2 = State.getEmployee(s2.employeeId);
  if (!emp1 || !emp2) return { ok: false, reason: '직원 정보를 찾을 수 없습니다.' };

  // 같은 날짜면 교환 불필요
  if (date1 === date2) return { ok: true };

  // 근무 가능 요일 체크 (emp1 → date2, emp2 → date1)
  const dow1 = new Date(date1 + 'T00:00:00').getDay(); // emp2가 가게 될 요일
  const dow2 = new Date(date2 + 'T00:00:00').getDay(); // emp1이 가게 될 요일

  if (!emp1.availableWorkDays.includes(dow2))
    return { ok: false, reason: `${emp1.name}님은 ${date2} 요일 근무 불가입니다.` };
  if (!emp2.availableWorkDays.includes(dow1))
    return { ok: false, reason: `${emp2.name}님은 ${date1} 요일 근무 불가입니다.` };

  // 휴무 신청일 체크
  if ((emp1.holidayRequests || []).includes(date2))
    return { ok: false, reason: `${date2}은 ${emp1.name}님의 휴무 신청일입니다.` };
  if ((emp2.holidayRequests || []).includes(date1))
    return { ok: false, reason: `${date1}은 ${emp2.name}님의 휴무 신청일입니다.` };

  // 교환 후 중복 체크 (교환 당사자 제외)
  const others = State.schedules.filter(s => s.id !== schId1 && s.id !== schId2);
  if (others.some(s => s.date === date2 && s.employeeId === emp1.id))
    return { ok: false, reason: `${emp1.name}님은 ${date2}에 이미 배정되어 있습니다.` };
  if (others.some(s => s.date === date1 && s.employeeId === emp2.id))
    return { ok: false, reason: `${emp2.name}님은 ${date1}에 이미 배정되어 있습니다.` };

  // ── 교환 후 주 52h / 주 최대 근무일 시뮬레이션 ──
  const h1 = s1.workingHours || emp1.dailyWorkHours || 8;
  const h2 = s2.workingHours || emp2.dailyWorkHours || 8;
  const maxHours = State.settings.weeklyMaximumHours;

  // others 기준 주간 집계
  const agg = {};
  for (const s of others) {
    const wk = getWeekKey(s.date);
    agg[s.employeeId] ??= {};
    agg[s.employeeId][wk] ??= { hours: 0, days: 0 };
    agg[s.employeeId][wk].hours += s.workingHours || 0;
    agg[s.employeeId][wk].days  += 1;
  }
  const peek = (empId, wk) => agg[empId]?.[wk] || { hours: 0, days: 0 };

  const wk1 = getWeekKey(date1); // emp2가 갈 주
  const wk2 = getWeekKey(date2); // emp1이 갈 주

  const e1After = peek(emp1.id, wk2);
  const e2After = peek(emp2.id, wk1);

  if (e1After.hours + h1 > maxHours)
    return { ok: false, overtime: true,
      reason: `${emp1.name}님의 ${wk2} 주 근무시간이 ${maxHours}시간을 초과합니다.\n(${e1After.hours}h + ${h1}h = ${e1After.hours + h1}h)` };
  if (e2After.hours + h2 > maxHours)
    return { ok: false, overtime: true,
      reason: `${emp2.name}님의 ${wk1} 주 근무시간이 ${maxHours}시간을 초과합니다.\n(${e2After.hours}h + ${h2}h = ${e2After.hours + h2}h)` };

  const bothIds = [schId1, schId2];

  if (!_isFullTimeAdmin(emp1)) {
    const eff1 = _effMaxDays(emp1);
    if (e1After.days + 1 > eff1)
      return { ok: false, reason: `${emp1.name}님의 주 최대 근무일(${eff1}일)을 초과합니다.` };
    const lim1 = emp1.maxConsecutiveDays || 5;
    const c1 = countConsecutiveIfAdded(emp1.id, date2, bothIds);
    if (c1 > lim1)
      return { ok: false, reason: `${emp1.name}님의 연속근무 상한(${lim1}일)을 초과합니다. (${c1}일 연속)` };
  }

  if (!_isFullTimeAdmin(emp2)) {
    const eff2 = _effMaxDays(emp2);
    if (e2After.days + 1 > eff2)
      return { ok: false, reason: `${emp2.name}님의 주 최대 근무일(${eff2}일)을 초과합니다.` };
    const lim2 = emp2.maxConsecutiveDays || 5;
    const c2 = countConsecutiveIfAdded(emp2.id, date1, bothIds);
    if (c2 > lim2)
      return { ok: false, reason: `${emp2.name}님의 연속근무 상한(${lim2}일)을 초과합니다. (${c2}일 연속)` };
  }

  // 교환 실행
  State.updateSchedule(schId1, { date: date2 });
  State.updateSchedule(schId2, { date: date1 });
  return { ok: true };
}

/**
 * 특정 날짜에 배정했을 때의 연속근무 일수 (전후 구간을 모두 이어서 계산)
 * @param {string} employeeId
 * @param {string} dateStr        새로 배정할 날짜
 * @param {string[]} excludeIds   계산에서 제외할 스케줄 ID (이동 시 원본 등)
 */
export function countConsecutiveIfAdded(employeeId, dateStr, excludeIds = []) {
  const set = new Set(
    State.schedules
      .filter(s => s.employeeId === employeeId && !excludeIds.includes(s.id))
      .map(s => s.date)
  );
  set.add(dateStr);

  const toKey = d =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const base = new Date(dateStr + 'T00:00:00').getTime();
  let count = 1;

  // 뒤로 (과거 방향)
  for (let i = 1; i <= 30; i++) {
    if (!set.has(toKey(new Date(base - i * 86400000)))) break;
    count++;
  }
  // 앞으로 (미래 방향)
  for (let i = 1; i <= 30; i++) {
    if (!set.has(toKey(new Date(base + i * 86400000)))) break;
    count++;
  }
  return count;
}

/** 단일 배정 유효성 검사 (외부 확장용 유틸 — 현재 내부 호출 없음) */
export function validateAssignment(emp, dateStr, weekKey, weekTracker, maxWeekHours) {
  if ((emp.holidayRequests || []).includes(dateStr))
    return { ok: false, reason: '휴무 신청일' };
  const track = weekTracker?.[emp.id]?.[weekKey] || { hours: 0, days: 0 };
  if (track.days >= emp.maxWorkDaysPerWeek)
    return { ok: false, reason: `주 최대 근무일(${emp.maxWorkDaysPerWeek}일) 초과` };
  if (track.hours + emp.dailyWorkHours > maxWeekHours)
    return { ok: false, reason: `주 최대 ${maxWeekHours}h 초과` };
  if (State.schedules.some(s => s.date === dateStr && s.employeeId === emp.id))
    return { ok: false, reason: '이미 배정됨' };
  return { ok: true, reason: '' };
}

// ══════════════════════════════════════════════════════
// 월간 통계
// ══════════════════════════════════════════════════════
export function getMonthlyStats(employeeId, year, month) {
  const entries = State.getSchedulesByEmployeeMonth(employeeId, year, month)
    .filter(s => belongsToMonth(s.date, year, month));

  const totalDays  = entries.length;
  const totalHours = entries.reduce((sum, s) => sum + (s.workingHours || 0), 0);

  const weekMap = {};
  entries.forEach(s => {
    const wk = getWeekKey(s.date);
    if (!weekMap[wk]) weekMap[wk] = { days: 0, hours: 0 };
    weekMap[wk].days  += 1;
    weekMap[wk].hours += s.workingHours || 0;
  });

  const weeklyBreakdown = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, stats]) => ({ weekStart, ...stats }));

  const avgWeekHours = weeklyBreakdown.length
    ? weeklyBreakdown.reduce((s, w) => s + w.hours, 0) / weeklyBreakdown.length
    : 0;

  // 초단시간 판정: 월초/월말 잘린 주가 평균을 왜곡하므로
  // '완전한 주'(월~일이 모두 해당 월에 포함)만으로 평균을 재계산해 판정
  const fullWeeks = weeklyBreakdown.filter(w => {
    const mon = new Date(w.weekStart + 'T00:00:00');
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return belongsToMonth(w.weekStart, year, month) &&
           belongsToMonth(
             `${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,'0')}-${String(sun.getDate()).padStart(2,'0')}`,
             year, month
           );
  });
  const judgeWeeks = fullWeeks.length ? fullWeeks : weeklyBreakdown;
  const judgeAvg   = judgeWeeks.length
    ? judgeWeeks.reduce((s, w) => s + w.hours, 0) / judgeWeeks.length
    : 0;

  return {
    totalDays, totalHours, weeklyBreakdown,
    isShortTimeWorker: judgeAvg < 15,
    avgWeekHours,
  };
}

/**
 * 주휴수당 지급 요건: 그 주 '소정근로일'을 개근했는지
 * 소정근로일 = 희망 주 근무일(targetWorkDaysPerWeek). 없으면 maxWorkDaysPerWeek 폴백.
 * (기존에는 maxWorkDaysPerWeek 기준이라 사실상 항상 미달 → 주휴수당 0원 버그)
 */
export function didWorkFullWeek(employeeId, weekKey) {
  const emp = State.getEmployee(employeeId);
  if (!emp) return false;
  const contracted = emp.targetWorkDaysPerWeek || emp.maxWorkDaysPerWeek || 5;
  return State.getWeeklyDays(employeeId, weekKey) >= contracted;
}
