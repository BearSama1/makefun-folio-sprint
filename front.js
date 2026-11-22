// Scan only the header; leave body bytes alone, including trailing newlines.
const field = /^([a-z_]+)(?:: (.*)|:)$/;
const blank = /^[ \t]*$/;
const tailSpaces = /[ \t]+$/;
const monthEnds = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dateShape = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const invalidDate = 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
const layoutShape = /^[a-z0-9-]+$/;
const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const badTag = /["\[\]]/;
const quoteOrSlash = /["\\]/;
const allowedEscape = /\\(["\\])/g;

const fail = error => ({error});
const keyFail = (key, why) => fail(`key "${key}": ${why}`);

export function front(source) {
  if (!source.startsWith('---\n')) return fail(source === '---' ? 'the front matter is not closed' : 'no front matter');
  let close = source.indexOf('\n---');
  while (close !== -1 && close + 4 !== source.length && source.charCodeAt(close + 4) !== 10) {
    close = source.indexOf('\n---', close + 4);
  }
  if (close < 0) return fail('the front matter is not closed');

  const data = {};
  let mask = 0;
  let at = 4;
  let number = 2;
  for (; at <= close; number++) {
    const next = source.indexOf('\n', at);
    const line = source.slice(at, next);
    at = next + 1;
    if (line.charCodeAt(0) === 35 || blank.test(line)) continue;
    const match = field.exec(line);
    if (match === null) return fail(`line ${number} is not "key: value"`);
    const key = match[1];
    let bit;
    switch (key) {
      case 'title': bit = 1; break;
      case 'summary': bit = 2; break;
      case 'date': bit = 4; break;
      case 'tags': bit = 8; break;
      case 'draft': bit = 16; break;
      case 'layout': bit = 32; break;
      case 'slug': bit = 64; break;
      default: return fail(`unknown key "${key}"`);
    }
    if (mask & bit) return fail(`key "${key}" is given twice`);
    mask |= bit;
    const raw = (match[2] ?? '').replace(tailSpaces, '');
    if (raw === '') return fail(`key "${key}" has no value`);

    let value = raw;
    if (bit < 4) {
      const first = raw.charCodeAt(0);
      if (first === 34) {
        if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return keyFail(key, 'a quoted string is not closed');
        value = raw.slice(1, -1);
        if (quoteOrSlash.test(value)) {
          for (let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i);
            if (c === 34) return keyFail(key, 'a quoted string holds a stray quote');
            if (c !== 92) continue;
            const escaped = value.charCodeAt(++i);
            if (escaped !== 34 && escaped !== 92) return keyFail(key, 'a quoted string holds an escape other than \\" or \\\\');
          }
          value = value.replace(allowedEscape, '$1');
        }
      } else if (first === 91) return keyFail(key, 'a bare string opens on [');
    } else if (bit === 4) {
      if (!dateShape.test(raw)) return keyFail(key, invalidDate);
      const year = +raw.slice(0, 4), month = +raw.slice(5, 7), day = +raw.slice(8);
      if (year < 1970 || year > 2099 || month < 1 || month > 12 || day < 1 ||
          day > monthEnds[month] + (month === 2 && year % 4 === 0 ? 1 : 0)) return keyFail(key, invalidDate);
    } else if (bit === 8) {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return keyFail(key, 'not a list [a, b]');
      const innards = raw.slice(1, -1);
      value = [];
      if (innards.trim() !== '') {
        if (badTag.test(innards)) return keyFail(key, 'an empty tag, or one holding " [ or ]');
        for (const item of innards.split(',')) {
          const tag = item.trim();
          if (tag === '') return keyFail(key, 'an empty tag, or one holding " [ or ]');
          value.push(tag);
        }
      }
    } else if (bit === 16) {
      if (raw === 'true') value = true;
      else if (raw === 'false') value = false;
      else return keyFail(key, 'true or false');
    } else if (bit === 32) {
      if (!layoutShape.test(raw)) return keyFail(key, 'not a template name');
    } else if (raw.length > 64 || !slugShape.test(raw)) return keyFail(key, 'not a slug');

    data[key] = value;
  }
  if (!(mask & 1)) return fail('no title');
  return {data, body: source.slice(close + 5)};
}
