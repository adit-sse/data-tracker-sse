function computeEnd(startStr) {
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return null;
  const year = start.getFullYear();
  const month = start.getMonth();
  const day = start.getDate();
  let end;
  if (day === 1) {
    end = new Date(year, month + 1, 0);
  } else {
    const nextMonth = month + 1;
    const lastDayNextMonth = new Date(year, nextMonth + 1, 0).getDate();
    const dayToUse = Math.min(day, lastDayNextMonth);
    end = new Date(year, nextMonth, dayToUse);
  }
  // Format using local date components to avoid timezone shifts
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const cases = ['2026-03-01', '2026-01-31', '2026-02-15'];
for (const s of cases) {
  console.log(s, '->', computeEnd(s));
}
