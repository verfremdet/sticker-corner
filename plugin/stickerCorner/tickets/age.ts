/*
 * Ticket helper – finds the date of birth (or a plain age) in what the ticket creator wrote.
 * Understands: 10/21/08 · 21.10.2008 · 21-10-08 · 2008-10-21 · 21 oct 2008 · october 21st, 2008 ·
 * "i'm 17" · "17 years" · "17yo" · "age: 17". With US/EU ambiguity (05/06/08) both readings are checked.
 */

export interface AgeResult {
    /** lowest and highest possible age (equal when certain) */
    min: number;
    max: number;
    /** what was found, e.g. "21.10.2008" */
    source: string;
    /** the date if one was found */
    date?: Date;
}

const MONTHS: Record<string, number> = {
    jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, märz: 3, maerz: 3, apr: 4, april: 4,
    may: 5, mai: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dez: 12, dezember: 12,
};

function fullYear(y: number, now: Date): number {
    if (y >= 100) return y;
    const cur = now.getFullYear() % 100;
    return y <= cur ? 2000 + y : 1900 + y;
}

function valid(y: number, m: number, d: number, now: Date): Date | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    if (date.getMonth() !== m - 1 || date > now) return null;
    const age = ageOn(date, now);
    return age >= 5 && age <= 80 ? date : null;
}

export function ageOn(birth: Date, now = new Date()): number {
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
}

const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

function fromDates(dates: Date[], source: string, now: Date): AgeResult | null {
    if (!dates.length) return null;
    const ages = dates.map(d => ageOn(d, now));
    const min = Math.min(...ages), max = Math.max(...ages);
    return { min, max, source, date: dates.length === 1 || min === max ? dates[0] : undefined };
}

export function findAge(texts: string[], now = new Date()): AgeResult | null {
    for (const raw of texts) {
        const text = raw.toLowerCase();

        // 2008-10-21 / 2008.10.21
        let m = /\b((?:19|20)\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/.exec(text);
        if (m) {
            const d = valid(+m[1], +m[2], +m[3], now);
            if (d) return fromDates([d], fmt(d), now);
        }

        // 10/21/08 · 21.10.2008 · 21-10-08 (day/month order unknown → try both)
        m = /\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2}|\d{4})\b/.exec(text);
        if (m) {
            const a = +m[1], b = +m[2], y = fullYear(+m[3], now);
            const eu = valid(y, b, a, now); // day.month (German style, and "." usually means EU)
            const us = m[0].includes(".") ? null : valid(y, a, b, now); // month/day
            const dates = [eu, us].filter((d): d is Date => !!d);
            const uniq = dates.filter((d, i) => dates.findIndex(x => x.getTime() === d.getTime()) === i);
            const r = fromDates(uniq, uniq.length === 1 ? fmt(uniq[0]) : m[0], now);
            if (r) return r;
        }

        // 21 oct 2008 · 21st of october 2008 · 21. oktober 2008
        m = /\b(\d{1,2})(?:st|nd|rd|th|\.)?\s*(?:of\s+)?([a-zäöü]{3,9})\.?,?\s*((?:19|20)?\d{2})\b/.exec(text);
        if (m && MONTHS[m[2]]) {
            const d = valid(fullYear(+m[3], now), MONTHS[m[2]], +m[1], now);
            if (d) return fromDates([d], fmt(d), now);
        }

        // october 21st, 2008 · oct 21 08
        m = /\b([a-zäöü]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?,?\s*((?:19|20)?\d{2})\b/.exec(text);
        if (m && MONTHS[m[1]]) {
            const d = valid(fullYear(+m[3], now), MONTHS[m[1]], +m[2], now);
            if (d) return fromDates([d], fmt(d), now);
        }

        // i'm 17 · im 17 · i am 17 · 17 years (old) · 17yo · 17 y/o · age: 17 · ich bin 17 · 17 jahre
        m = /\b(?:i'?m|i am|ich bin|age:?|alter:?)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:years?(?: old)?|yrs?|y\/?o|jahre?(?: alt)?)\b/.exec(text);
        if (m) {
            const age = +(m[1] ?? m[2]);
            if (age >= 8 && age <= 80) return { min: age, max: age, source: m[0].trim() };
        }
    }
    return null;
}
