// holidays.js — 한국 공휴일 데이터 & 유틸리티
// 순수 데이터/판별 함수만 담당. UI 조작 없음.

export const KOREAN_HOLIDAYS = {
  // 2025
  '2025-01-01': '신정',
  '2025-01-28': '설날 연휴',
  '2025-01-29': '설날',
  '2025-01-30': '설날 연휴',
  '2025-03-01': '삼일절',
  '2025-05-05': '어린이날',
  '2025-05-06': '어린이날 대체공휴일',
  '2025-05-29': '부처님오신날',
  '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절',
  '2025-10-05': '추석 연휴',
  '2025-10-06': '추석',
  '2025-10-07': '추석 연휴',
  '2025-10-08': '추석 대체공휴일',
  '2025-10-09': '한글날',
  '2025-12-25': '크리스마스',
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '크리스마스',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절',
  '2027-10-03': '개천절',
  '2027-10-09': '한글날',
  '2027-10-14': '추석 연휴',
  '2027-10-15': '추석',
  '2027-10-16': '추석 연휴',
  '2027-12-25': '크리스마스',
};

/** @param {string} dateStr YYYY-MM-DD */
export function isHoliday(dateStr) {
  return Object.prototype.hasOwnProperty.call(KOREAN_HOLIDAYS, dateStr);
}

/** @param {string} dateStr */
export function getHolidayName(dateStr) {
  return KOREAN_HOLIDAYS[dateStr] || null;
}

/** 토·일 여부 */
export function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** 캘린더 빨간 날짜 (공휴일 or 토·일) */
export function isRedDay(dateStr) {
  return isWeekend(dateStr) || isHoliday(dateStr);
}

/** 월의 모든 날짜 배열 */
export function getDaysInMonth(year, month) {
  const days = [];
  const count = new Date(year, month, 0).getDate();
  for (let d = 1; d <= count; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

/**
 * 해당 주의 월요일 날짜 문자열 반환 (주 키로 활용)
 * @param {string} dateStr
 * @returns {string} YYYY-MM-DD (해당 주 월요일)
 */
export function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // 1=월 ~ 7=일
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow - 1));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** dateStr이 year/month에 속하는지 */
export function belongsToMonth(dateStr, year, month) {
  return dateStr.startsWith(`${year}-${String(month).padStart(2, '0')}`);
}

/** 날짜 포맷: YYYY-MM-DD → M월 D일 (요일) */
export function formatDateKo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dayNames[d.getDay()]})`;
}

export const DAY_NAMES_KO  = ['일', '월', '화', '수', '목', '금', '토'];
export const DAY_NAMES_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

/** HTML 이스케이프 — innerHTML에 사용자 입력을 넣기 전 반드시 통과시킬 것 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
