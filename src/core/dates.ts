/**
 * The UTC day of a date bound, so two datetimes with different offsets keep their order.
 * @param value - ISO 8601 date or datetime.
 * @returns {string} `YYYY-MM-DD`, cut from the text when it does not parse.
 */
export function utcDay(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value.slice(0, 10) : new Date(time).toISOString().slice(0, 10);
}
