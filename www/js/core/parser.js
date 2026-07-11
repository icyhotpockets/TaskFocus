import { addLocalDays, endOfLocalDay, startOfLocalDay } from './time.js';

const WEEKDAYS = Object.freeze({
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
});

const MONTHS = Object.freeze({
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9,
  october: 9, nov: 10, november: 10, dec: 11, december: 11,
});

function localDate(year, month, day, hour = 0, minute = 0) {
  const value = new Date(year, month, day, hour, minute, 0, 0);
  if (value.getFullYear() !== year || value.getMonth() !== month || value.getDate() !== day) return null;
  return value;
}

function parseTimeMatch(match) {
  let hour = Number(match.groups.hour12 ?? match.groups.hour24);
  const minute = Number(match.groups.minute12 ?? match.groups.minute24 ?? 0);
  const meridiem = match.groups.meridiem?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === 'pm') hour += 12;
  } else if (hour > 23) return null;
  return { hour, minute };
}

function displayDateTime(timestamp, allDay) {
  const date = new Date(timestamp);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  if (allDay) return `${month} ${day}`;
  return `${month} ${day} · ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addToken(tokens, type, match, label, value) {
  tokens.push({ type, label, value, start: match.index, end: match.index + match[0].length });
}

function isCleared(cleared, type) {
  return cleared.has(type) || cleared.has(type === 'date' || type === 'time' ? 'due' : type);
}

function cleanedTitle(input, tokens) {
  const chars = input.split('');
  for (const token of tokens) {
    for (let index = token.start; index < token.end; index += 1) chars[index] = ' ';
  }
  return chars.join('')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function parseQuickAdd(input, options = {}) {
  const text = String(input ?? '');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const nowDate = new Date(now);
  const cleared = new Set(options.clearedTypes ?? options.cleared ?? []);
  const tokens = [];
  const values = { due: null, allDay: false, reminder: null, priority: null, tags: [] };

  if (!isCleared(cleared, 'reminder')) {
    const interval = /\bevery\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.exec(text);
    if (interval) {
      const amount = Number(interval[1]);
      const intervalMin = /^h/i.test(interval[2]) ? amount * 60 : amount;
      if (intervalMin > 0) {
        values.reminder = { intervalMin, startAt: null };
        addToken(tokens, 'reminder', interval, `every ${intervalMin >= 60 && intervalMin % 60 === 0 ? `${intervalMin / 60}h` : `${intervalMin}m`}`, values.reminder);
      }
    }
  }

  if (!isCleared(cleared, 'priority')) {
    const priority = /(?<!#)\b(high|low)(?:\s+priority)?\b/i.exec(text);
    if (priority) {
      values.priority = priority[1].toLowerCase() === 'high' ? 2 : 0;
      addToken(tokens, 'priority', priority, priority[1].toLowerCase(), values.priority);
    }
  }

  if (!isCleared(cleared, 'tags')) {
    const tagPattern = /#([a-z0-9][a-z0-9_-]*)/gi;
    for (const tag of text.matchAll(tagPattern)) {
      const normalized = tag[1].toLowerCase();
      if (!values.tags.includes(normalized)) values.tags.push(normalized);
      addToken(tokens, 'tags', tag, `#${normalized}`, normalized);
    }
  }

  let dateParts = null;
  let dateMatch = null;
  let dateKind = null;
  if (!isCleared(cleared, 'date')) {
    const relative = /(?<!#)\b(today|tomorrow)\b/i.exec(text);
    const weekday = new RegExp(`(?<!#)\\b(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i').exec(text);
    const monthDate = new RegExp(`(?<!#)\\b(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text);

    if (relative) {
      const dayOffset = relative[1].toLowerCase() === 'tomorrow' ? 1 : 0;
      const date = new Date(addLocalDays(startOfLocalDay(now), dayOffset));
      dateParts = { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
      dateMatch = relative;
      dateKind = relative[1].toLowerCase();
    } else if (weekday) {
      const target = WEEKDAYS[weekday[1].toLowerCase()];
      const offset = (target - nowDate.getDay() + 7) % 7;
      const date = new Date(addLocalDays(startOfLocalDay(now), offset));
      dateParts = { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
      dateMatch = weekday;
      dateKind = 'weekday';
    } else if (monthDate) {
      const month = MONTHS[monthDate[1].toLowerCase()];
      const day = Number(monthDate[2]);
      let year = monthDate[3] ? Number(monthDate[3]) : nowDate.getFullYear();
      let candidate = localDate(year, month, day);
      if (candidate && !monthDate[3] && endOfLocalDay(candidate) < startOfLocalDay(now)) {
        year += 1;
        candidate = localDate(year, month, day);
      }
      if (candidate) {
        dateParts = { year, month, day };
        dateMatch = monthDate;
        dateKind = monthDate[3] ? 'fixed-date' : 'month-date';
      }
    }
  }

  let timeParts = null;
  let timeMatch = null;
  if (!isCleared(cleared, 'time')) {
    const pattern = /\b(?:(?<hour12>\d{1,2})(?::(?<minute12>\d{2}))?\s*(?<meridiem>am|pm)|(?<hour24>\d{1,2}):(?<minute24>\d{2}))\b/i;
    const candidate = pattern.exec(text);
    const parsed = candidate ? parseTimeMatch(candidate) : null;
    if (parsed) {
      timeParts = parsed;
      timeMatch = candidate;
    }
  }

  if (dateParts || timeParts) {
    let dueDate;
    let allDay = !timeParts;
    if (dateParts) {
      dueDate = localDate(dateParts.year, dateParts.month, dateParts.day,
        timeParts?.hour ?? 0, timeParts?.minute ?? 0);
      if (allDay && dueDate) dueDate = new Date(endOfLocalDay(dueDate));
      if (dueDate && timeParts && dateKind === 'weekday' && dueDate.getTime() <= now) {
        dueDate = new Date(addLocalDays(dueDate, 7));
      }
    } else {
      dueDate = new Date(now);
      dueDate.setHours(timeParts.hour, timeParts.minute, 0, 0);
      if (dueDate.getTime() <= now) dueDate = new Date(addLocalDays(dueDate, 1));
      allDay = false;
    }

    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      values.due = dueDate.getTime();
      values.allDay = allDay;
      const label = displayDateTime(values.due, allDay);
      if (dateMatch) addToken(tokens, 'date', dateMatch, label, values.due);
      if (timeMatch) addToken(tokens, 'time', timeMatch, label, values.due);
    }
  }

  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    title: cleanedTitle(text, tokens),
    due: values.due,
    allDay: values.allDay,
    reminder: values.reminder,
    priority: values.priority,
    tags: values.tags,
    values,
    parsed: tokens,
  };
}
