// scheduleExport.js — 스케줄표를 PNG 이미지로 저장
// 외부 라이브러리 없이 Canvas API로 직접 렌더링 (오프라인 동작)

import { State } from './state.js';
import { getDaysInMonth, getHolidayName, isWeekend, isRedDay, DAY_NAMES_KO } from './holidays.js';
import { compareByRank } from './employees.js';

// ── 레이아웃 상수 ──────────────────────────────
const PAD          = 32;   // 바깥 여백
const TITLE_H      = 56;   // 제목 영역
const LEGEND_ROW_H = 28;   // 범례 한 줄 높이
const HEADER_H     = 38;   // 요일 헤더
const CELL_W       = 168;  // 셀 너비
const CELL_MIN_H   = 96;   // 셀 최소 높이
const DAYNUM_H     = 26;   // 날짜 숫자 영역
const TAG_H        = 22;   // 직원 태그 높이
const TAG_GAP      = 4;
const TAG_PAD      = 6;
const SCALE        = 2;    // 레티나 대응 (2배 해상도)

const C = {
  bg:       '#FFFFFF',
  text:     '#111827',
  sub:      '#6B7280',
  line:     '#E5E7EB',
  headerBg: '#F9FAFB',
  redBg:    '#FEF2F2',
  red:      '#DC2626',
  otherBg:  '#FAFAFA',
  otherTxt: '#D1D5DB',
};

/**
 * 스케줄 달력을 PNG로 저장
 * @param {number} year
 * @param {number} month
 * @param {string|null} filterEmpId  지정 시 해당 직원만 표시
 */
export function exportScheduleImage(year, month, filterEmpId = null) {
  const days     = getDaysInMonth(year, month);
  const firstDow = new Date(`${year}-${String(month).padStart(2,'0')}-01T00:00:00`).getDay();
  const rows     = Math.ceil((firstDow + days.length) / 7);

  // ── 각 날짜의 표시 대상 직원 계산 ──
  const dayEmps = {};
  let maxTags = 0;
  for (const dateStr of days) {
    const list = State.getSchedulesByDate(dateStr)
      .map(s => {
        const emp = State.getEmployee(s.employeeId);
        if (!emp) return null;
        return { ...emp, _hours: s.workingHours ?? emp.dailyWorkHours ?? 8 };
      })
      .filter(Boolean)
      .filter(emp => !filterEmpId || emp.id === filterEmpId)
      .sort(compareByRank);   // 직급 높은 순
    dayEmps[dateStr] = list;
    if (list.length > maxTags) maxTags = list.length;
  }

  // ── 행 높이: 그 행에서 가장 많은 태그 수 기준 ──
  const rowHeights = [];
  for (let r = 0; r < rows; r++) {
    let rowMax = 0;
    for (let c = 0; c < 7; c++) {
      const di = r * 7 + c - firstDow;
      if (di < 0 || di >= days.length) continue;
      rowMax = Math.max(rowMax, dayEmps[days[di]].length);
    }
    const needed = DAYNUM_H + rowMax * (TAG_H + TAG_GAP) + TAG_PAD * 2;
    rowHeights.push(Math.max(CELL_MIN_H, needed));
  }

  // ── 범례 (필터 시 해당 직원만) ──
  const legendEmps = (filterEmpId
    ? State.employees.filter(e => e.id === filterEmpId)
    : State.employees.slice()
  ).sort(compareByRank);
  const perRow      = Math.max(1, Math.floor((CELL_W * 7) / 150));
  const legendRows  = Math.ceil(legendEmps.length / perRow);
  const legendH     = legendEmps.length ? legendRows * LEGEND_ROW_H + 12 : 0;

  // ── 캔버스 크기 ──
  const gridW = CELL_W * 7;
  const gridH = rowHeights.reduce((a, b) => a + b, 0);
  const W = PAD * 2 + gridW;
  const H = PAD * 2 + TITLE_H + legendH + HEADER_H + gridH + 26; // 26 = 하단 주석

  const canvas = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'middle';

  // ── 배경 ──
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // ── 제목 ──
  const filterName = filterEmpId ? State.getEmployee(filterEmpId)?.name : null;
  ctx.fillStyle = C.text;
  ctx.font = 'bold 26px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${year}년 ${month}월 근무 스케줄${filterName ? ` — ${filterName}` : ''}`, PAD, y + 18);

  ctx.fillStyle = C.sub;
  ctx.font = '13px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'right';
  const today = new Date();
  ctx.fillText(
    `출력일 ${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,
    W - PAD, y + 18
  );
  ctx.textAlign = 'left';
  y += TITLE_H;

  // ── 범례 ──
  if (legendEmps.length) {
    ctx.font = '13px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    legendEmps.forEach((emp, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const lx = PAD + col * 150;
      const ly = y + row * LEGEND_ROW_H + 10;
      ctx.fillStyle = emp.color || '#999';
      _roundRect(ctx, lx, ly - 6, 12, 12, 3); ctx.fill();
      ctx.fillStyle = C.text;
      ctx.fillText(_ellipsis(ctx, emp.name, 120), lx + 18, ly);
    });
    y += legendH;
  }

  // ── 요일 헤더 ──
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(PAD, y, gridW, HEADER_H);
  ctx.font = 'bold 14px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center';
  DAY_NAMES_KO.forEach((n, i) => {
    ctx.fillStyle = (i === 0 || i === 6) ? C.red : C.text;
    ctx.fillText(n, PAD + i * CELL_W + CELL_W / 2, y + HEADER_H / 2);
  });
  ctx.textAlign = 'left';
  const gridTop = y + HEADER_H;

  // ── 셀 ──
  let cy = gridTop;
  for (let r = 0; r < rows; r++) {
    const rh = rowHeights[r];
    for (let c = 0; c < 7; c++) {
      const cx = PAD + c * CELL_W;
      const di = r * 7 + c - firstDow;

      if (di < 0 || di >= days.length) {
        ctx.fillStyle = C.otherBg;
        ctx.fillRect(cx, cy, CELL_W, rh);
        continue;
      }

      const dateStr = days[di];
      const d       = new Date(dateStr + 'T00:00:00');
      const red     = isRedDay(dateStr);
      const holiday = getHolidayName(dateStr);
      const weekend = isWeekend(dateStr);

      // 셀 배경
      ctx.fillStyle = red ? C.redBg : C.bg;
      ctx.fillRect(cx, cy, CELL_W, rh);

      // 날짜 숫자
      ctx.font = 'bold 15px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      ctx.fillStyle = red ? C.red : C.text;
      ctx.fillText(String(d.getDate()), cx + 9, cy + 15);

      // 공휴일 이름
      if (holiday && !weekend) {
        ctx.font = '10px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
        ctx.fillStyle = C.red;
        ctx.textAlign = 'right';
        ctx.fillText(_ellipsis(ctx, holiday, CELL_W - 40), cx + CELL_W - 8, cy + 15);
        ctx.textAlign = 'left';
      }

      // 직원 태그
      let ty = cy + DAYNUM_H;
      ctx.font = 'bold 12px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      for (const emp of dayEmps[dateStr]) {
        const tagW = CELL_W - TAG_PAD * 2;
        ctx.fillStyle = emp.color || '#3B82F6';
        _roundRect(ctx, cx + TAG_PAD, ty, tagW, TAG_H, 4);
        ctx.fill();

        // 시간 (오른쪽 정렬)
        const hLabel = `${emp._hours}h`;
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.font = '11px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(hLabel, cx + TAG_PAD + tagW - 7, ty + TAG_H / 2);
        const hW = ctx.measureText(hLabel).width;

        // 이름 (왼쪽 정렬, 시간 영역 제외)
        ctx.textAlign = 'left';
        ctx.font = 'bold 12px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(_ellipsis(ctx, emp.name, tagW - hW - 20), cx + TAG_PAD + 7, ty + TAG_H / 2);

        ty += TAG_H + TAG_GAP;
      }
    }
    cy += rh;
  }

  // ── 격자선 ──
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let ly2 = gridTop;
  ctx.moveTo(PAD, ly2 - HEADER_H); ctx.lineTo(PAD + gridW, ly2 - HEADER_H);
  ctx.moveTo(PAD, ly2);            ctx.lineTo(PAD + gridW, ly2);
  for (const rh of rowHeights) { ly2 += rh; ctx.moveTo(PAD, ly2); ctx.lineTo(PAD + gridW, ly2); }
  for (let c = 0; c <= 7; c++) {
    const x = PAD + c * CELL_W;
    ctx.moveTo(x, gridTop - HEADER_H); ctx.lineTo(x, gridTop + gridH);
  }
  ctx.stroke();

  // ── 하단 주석 ──
  ctx.font = '11px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.fillStyle = C.sub;
  const totalCnt = days.reduce((s, d) => s + dayEmps[d].length, 0);
  const totalHrs = days.reduce((s, d) => s + dayEmps[d].reduce((a, e) => a + e._hours, 0), 0);
  ctx.fillText(`총 ${totalCnt}건 배정 · ${totalHrs}시간 · 근무 관리 시스템`, PAD, gridTop + gridH + 16);

  // ── 다운로드 ──
  const fname = `스케줄_${year}-${String(month).padStart(2,'0')}${filterName ? `_${filterName}` : ''}.png`;
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');

  return fname;
}

// ── 유틸 ────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function _ellipsis(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
