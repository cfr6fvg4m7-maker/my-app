'use strict';

/* ============================================================
 * 文教大学 越谷キャンパス 学部 行事予定(授業日カレンダー)
 * 出典: 2026年度 文教大学行事予定(越谷キャンパス)
 *   https://www.koshigaya.bunkyo.ac.jp/kyomu/wp-content/uploads/sites/10/2026/02/2026koshigaya_gakubu_gyoujiyotei-3.pdf
 *
 * 授業日 = start〜end の月〜土のうち、off に入っていない日。
 * (祝日でも off になければ授業あり。classHolidays はその日の表示用の名前)
 * 新しい年度の予定が出たら、ここに追加する。
 * ============================================================ */

const ACADEMIC_CALENDAR = {
  '2026-spring': {
    start: '2026-04-09',
    end: '2026-07-27',
    exam: { start: '2026-07-28', end: '2026-08-03' },
    off: {
      '2026-05-01': '休講日',
      '2026-05-02': '休講日',
      '2026-05-04': 'みどりの日',
      '2026-05-14': '新入生歓迎スポーツ大会',
    },
    classHolidays: {
      '2026-04-29': '昭和の日',
      '2026-05-05': 'こどもの日',
      '2026-05-06': '振替休日',
      '2026-07-20': '海の日',
    },
  },
  '2026-fall': {
    start: '2026-09-05',
    end: '2027-01-19',
    exam: { start: '2027-01-20', end: '2027-01-26' },
    off: {
      '2026-09-07': '休講日',
      '2026-09-08': '休講日',
      '2026-09-09': '休講日',
      '2026-09-22': '国民の休日',
      '2026-09-23': '秋分の日',
      '2026-10-15': '体育祭',
      '2026-10-29': '学祭準備日',
      '2026-10-30': '学祭',
      '2026-10-31': '学祭',
      '2026-11-02': '学祭片付日',
      '2026-11-03': '文化の日',
      '2026-11-21': '入試(総合型選抜)',
      '2027-01-11': '成人の日',
      '2027-01-15': '休講日',
      '2027-01-16': '休講日',
    },
    offRanges: [
      { start: '2026-12-25', end: '2027-01-07', label: '冬季休業' },
    ],
    classHolidays: {
      '2026-09-21': '敬老の日',
      '2026-10-12': 'スポーツの日',
      '2026-10-17': '創立記念日',
      '2026-11-23': '勤労感謝の日',
    },
  },
};

// "2026-11-26" → Date(現地時刻)
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// その日が休みならその理由。授業日なら null
function calOffReason(cal, ds) {
  if (cal.off && cal.off[ds]) return cal.off[ds];
  for (const r of cal.offRanges || []) if (ds >= r.start && ds <= r.end) return r.label;
  if (parseYmd(ds).getDay() === 0) return '日曜日';
  return null;
}

// 学期の、ある曜日(1=月…6=土)の授業日一覧
function calClassDates(termId, weekday) {
  const cal = ACADEMIC_CALENDAR[termId];
  if (!cal) return null;
  const out = [];
  const d = parseYmd(cal.start);
  const end = parseYmd(cal.end);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  for (; d <= end; d.setDate(d.getDate() + 7)) {
    const ds = ymd(d);
    if (!calOffReason(cal, ds)) out.push(ds);
  }
  return out;
}

// 今日の学校の状況(授業日/休講日/休業期間/試験期間など)
function calDayInfo(date = new Date()) {
  const ds = ymd(date);
  for (const [termId, cal] of Object.entries(ACADEMIC_CALENDAR)) {
    if (cal.exam && ds >= cal.exam.start && ds <= cal.exam.end) return { termId, type: 'exam', label: '定期試験期間' };
    if (ds < cal.start || ds > cal.end) continue;
    const off = calOffReason(cal, ds);
    if (off) return { termId, type: 'off', label: off };
    return { termId, type: 'class', label: cal.classHolidays && cal.classHolidays[ds] ? `${cal.classHolidays[ds]}・授業あり` : null };
  }
  return null;
}
