// Shared language/runtime contract. These validators use explicit Gregorian
// calendar rules and lexical UTC ranges; they never parse a JavaScript Date.
// Compatibility export; vocabulary ownership lives outside temporal validation.
const { SUPPORTED_DATA_TYPES } = require('./data-types');
const DATE_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const TIMESTAMP_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$';
const DATE_MIN = '1000-01-01';
const DATE_MAX = '9999-12-31';
const TIMESTAMP_MIN = '1970-01-01T00:00:01Z';
const TIMESTAMP_MAX = '2038-01-19T03:14:07Z';

// Keep functions serializable with .toString() for generated dependency-free
// validation. isDate/isTimestamp depend only on this calendar helper.
function isCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || year < 1 || year > 9999 ||
        !Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(day) || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
}

function isDate(value) {
    if (typeof value !== 'string' || value.length !== 10 ||
        !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
        value < '1000-01-01' || value > '9999-12-31') return false;
    return isCalendarDate(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10)));
}

function isTimestamp(value) {
    if (typeof value !== 'string' || value.length !== 20 ||
        !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(value) ||
        value < '1970-01-01T00:00:01Z' || value > '2038-01-19T03:14:07Z') return false;
    return isCalendarDate(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))) &&
        Number(value.slice(11, 13)) <= 23 && Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59;
}

module.exports = { SUPPORTED_DATA_TYPES, DATE_PATTERN, TIMESTAMP_PATTERN,
    DATE_MIN, DATE_MAX, TIMESTAMP_MIN, TIMESTAMP_MAX, isCalendarDate, isDate, isTimestamp };
