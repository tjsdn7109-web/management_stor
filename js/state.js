// state.js — 전역 상태 관리 (싱글톤)
// 데이터 저장·로드만 담당. UI 조작 없음.

import { getWeekKey } from './holidays.js';

// ── 기본 설정 (단일 출처) ─────────────────────
// State 리터럴 안에서 메서드를 호출할 수 없으므로 바깥에 둔다.
// 이전에는 초기값을 리터럴에 중복 작성해 positions가 빠져 있었고,
// localStorage가 비어 있는 첫 실행에서 직급 추가가 실패했다.
function defaultSettings() {
  return {
    weeklyMaximumHours: 52,
    storeOperatingDays: [0, 1, 2, 3, 4, 5, 6], // 0=일~6=토
    // 요일별 하루 필요 근무 인원
    requiredStaffByDay: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 },
    // 직급 목록 — 배열 순서가 곧 서열 (위쪽이 높음)
    positions: [
      { name: '사장',       isAdmin: true  },
      { name: '매니저',     isAdmin: true  },
      { name: '정직원',     isAdmin: false },
      { name: '아르바이트', isAdmin: false },
      { name: '기타',       isAdmin: false },
    ],
    // 4대보험 요율 (퍼센트)
    insuranceRates: {
      nationalPension:     { employee: 4.5,   employer: 4.75  },
      healthInsurance:     { employee: 3.545, employer: 3.595 },
      longTermCareRate:    13.14,   // 장기요양 = 건강보험료 × 이 비율(%)
      employmentInsurance: { employee: 0.9,   employer: 1.15  },
      industrialAccident:  { employer: 1.0  },
    },
  };
}

export const State = {
  // ── 영속 데이터 ──────────────────────────────
  employees: [],   // Employee[]
  schedules: [],   // Schedule[]
  settings: defaultSettings(),

  // ── UI 상태 (미저장) ──────────────────────────
  ui: {
    currentView: 'welcome',     // 'welcome' | 'setup' | 'main'
    currentTab: 'employees',    // 'employees' | 'holidays' | 'schedule' | 'salary' | 'settings'
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    setupEmployeeIndex: 0,
    totalEmployeeCount: 0,
    selectedEmployeeId: null,
    calendarMode: 'holiday',    // 'holiday' | 'preferred'
    scheduleYear: new Date().getFullYear(),
    scheduleMonth: new Date().getMonth() + 1,
    // 직원 편집으로 스케줄에 영향이 갈 수 있는 변경 내역 (세션 한정)
    pendingEmployeeChanges: [],  // [{ empId, name, changes: [{ label, from, to }] }]
  },

  // ── ID 생성 ───────────────────────────────────
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  },

  // ── localStorage 저장 ─────────────────────────
  save() {
    try {
      localStorage.setItem('storeManager_v1', JSON.stringify({
        employees: this.employees,
        schedules: this.schedules,
        settings: this.settings,
      }));
    } catch (e) {
      console.error('[State] 저장 실패:', e);
    }
  },

  // ── localStorage 로드 ─────────────────────────
  load() {
    try {
      const raw = localStorage.getItem('storeManager_v1');
      if (!raw) return false;
      const data = JSON.parse(raw);
      // 구버전 직원 데이터 정규화: 누락된 필드에 기본값 보완
      this.employees = (data.employees || []).map(emp => {
        const type = emp.employmentType || 'hourly';
        // 구버전에 wage 단일 필드만 있던 경우 처리
        const legacyWage = emp.wage || emp.hourlyWage || emp.monthlyWage || 0;
        return {
          preferredDates: [],
          holidayRequests: [],
          notes: '',
          targetWorkDaysPerWeek: emp.maxWorkDaysPerWeek || 5,
          minRestDaysPerWeek: 1,
          maxConsecutiveDays: 5,
          hourlyWage:  type !== 'monthly' ? (emp.hourlyWage  || legacyWage || 10030) : 0,
          monthlyWage: type === 'monthly'  ? (emp.monthlyWage || legacyWage || 2500000) : 0,
          availableWorkDays: [1, 2, 3, 4, 5],
          color: '#3B82F6',
          ...emp,
        };
      });
      this.schedules = data.schedules || [];
      // 얕은 병합 후 insuranceRates·requiredStaffByDay 누락 보완 (깊은 병합)
      const saved = data.settings || {};
      const def   = this._defaultSettings();
      this.settings = {
        ...def,
        ...saved,
        insuranceRates:     { ...def.insuranceRates,     ...(saved.insuranceRates     || {}) },
        requiredStaffByDay: { ...def.requiredStaffByDay, ...(saved.requiredStaffByDay || {}) },
        // positions: 저장된 게 있으면 사용, 없으면 기본값
        positions: (saved.positions && saved.positions.length > 0)
          ? saved.positions
          : def.positions,
      };
      return true;
    } catch (e) {
      console.error('[State] 로드 실패:', e);
      return false;
    }
  },

  // ── 기본 설정값 반환 ──────────────────────────
  _defaultSettings() {
    return defaultSettings();
  },

  // ── 전체 초기화 ───────────────────────────────
  reset() {
    this.employees = [];
    this.schedules = [];
    this.settings  = this._defaultSettings();
    localStorage.removeItem('storeManager_v1');
  },

  // ══════════════════════════════════════════════
  // Employee 접근자
  // ══════════════════════════════════════════════
  getEmployee(id) {
    return this.employees.find(e => e.id === id) || null;
  },

  addEmployee(emp) {
    this.employees.push(emp);
    this.save();
  },

  updateEmployee(id, updates) {
    const idx = this.employees.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.employees[idx] = { ...this.employees[idx], ...updates };
      this.save();
    }
  },

  removeEmployee(id) {
    this.employees = this.employees.filter(e => e.id !== id);
    this.schedules = this.schedules.filter(s => s.employeeId !== id);
    this.save();
  },

  // ══════════════════════════════════════════════
  // Schedule 접근자
  // ══════════════════════════════════════════════
  getSchedulesByDate(dateStr) {
    return this.schedules.filter(s => s.date === dateStr);
  },

  getSchedulesByEmployee(employeeId) {
    return this.schedules.filter(s => s.employeeId === employeeId);
  },

  getSchedulesByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.schedules.filter(s => s.date.startsWith(prefix));
  },

  getSchedulesByEmployeeMonth(employeeId, year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.schedules.filter(s =>
      s.employeeId === employeeId && s.date.startsWith(prefix)
    );
  },

  addSchedule(entry) {
    const exists = this.schedules.some(
      s => s.date === entry.date && s.employeeId === entry.employeeId
    );
    if (!exists) {
      this.schedules.push({ id: this.generateId('sch'), ...entry });
      this.save();
      return true;
    }
    return false;
  },

  removeSchedule(id) {
    this.schedules = this.schedules.filter(s => s.id !== id);
    this.save();
  },

  removeScheduleByDateEmployee(dateStr, employeeId) {
    this.schedules = this.schedules.filter(
      s => !(s.date === dateStr && s.employeeId === employeeId)
    );
    this.save();
  },

  updateSchedule(id, updates) {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.schedules[idx] = { ...this.schedules[idx], ...updates };
      this.save();
    }
  },

  clearSchedulesByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    this.schedules = this.schedules.filter(s => !s.date.startsWith(prefix));
    this.save();
  },

  // ══════════════════════════════════════════════
  // 주간 근무 계산
  // ══════════════════════════════════════════════
  /** 직원의 특정 주 근무시간 합계 */
  getWeeklyHours(employeeId, weekKey) {
    return this.schedules
      .filter(s => s.employeeId === employeeId && getWeekKey(s.date) === weekKey)
      .reduce((sum, s) => sum + (s.workingHours || 0), 0);
  },

  /** 직원의 특정 주 근무일수 */
  getWeeklyDays(employeeId, weekKey) {
    return this.schedules.filter(
      s => s.employeeId === employeeId && getWeekKey(s.date) === weekKey
    ).length;
  },

  /** 직원의 특정 주 모든 스케줄 */
  getWeeklySchedules(employeeId, weekKey) {
    return this.schedules.filter(
      s => s.employeeId === employeeId && getWeekKey(s.date) === weekKey
    );
  },
};
