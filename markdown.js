// Inline scanning jumps over ordinary spans and emits each with a single escape pass.
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const entity = (c) => entities[c];
const escaped = (s) => s.replace(/[&<>"']/g, entity);
const canEscape = "\\`*_[]()#+-.!>";

function nextCloser(s, mark, start, single) {
  let j = start;
  while (j < s.length) {
    const k = s.indexOf(mark, j);
    if (k < 0) return -1;
    let slash = s.indexOf('\\', j);
    while (slash >= 0 && slash < k) {
      if (slash + 1 === k) {
        j = k + 1;
        break;
      }
      slash = s.indexOf('\\', slash + (s[slash + 1] === '\\' ? 2 : 1));
    }
    if (j === k + 1) continue;
    if (!single || s[k + 1] !== '*') return k;
    j = k + 2;
  }
  return -1;
}

function inline(source, link) {
  const special = /[\\`*\[&<>"']/g;
  return render(source);

  function render(s) {
    let pos = 0, out = '';
    while (pos < s.length) {
      special.lastIndex = pos;
      const hit = special.exec(s);
      if (hit === null) return out + s.slice(pos);
      const i = hit.index, first = hit[0], after = i + 1;
      out += s.slice(pos, i);
      pos = after;
      if (first === '\\') {
        if (after < s.length && canEscape.includes(s[after])) { const c = s[pos++]; out += entities[c] ?? c; }
        else out += first;
      } else if (first === '`') {
        const end = s.indexOf('`', after);
        if (end <= after) out += first;
        else {
          out += '<code>' + escaped(s.slice(after, end)) + '</code>';
          pos = end + 1;
        }
      } else if (first === '*') {
        const bold = s[after] === '*';
        const openEnd = after + +bold, name = bold ? 'strong' : 'em';
        const end = nextCloser(s, bold ? '**' : '*', openEnd, !bold);
        pos = openEnd;
        if (end <= openEnd) out += bold ? '**' : '*';
        else {
          out += '<' + name + '>' + render(s.slice(openEnd, end)) + '</' + name + '>';
          pos = end + 1 + +bold;
        }
      } else if (first === '[') {
        const end = nextCloser(s, ']', after, false);
        if (end !== -1 && s[end + 1] === '(') {
          const p = s.indexOf(')', end + 2);
          if (p > end + 2) {
            const url = s.slice(end + 2, p);
            if (!/\s/.test(url)) {
              out += '<a href="' + escaped(link(url)) + '">' + render(s.slice(after, end)) + '</a>';
              pos = p + 1;
              continue;
            }
          }
        }
        out += first;
      } else out += entities[first];
    }
    return out;
  }
}

// Render directly from lines rather than allocating an intermediate tree of blocks.
const trim = (s) => s.replace(/^[ \t]+|[ \t]+$/g, '');
const blank = /^[ \t]*$/;
const fence = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const fenceEnd = /^```[ \t]*$/;
const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const ruler = /^(?:---|\*\*\*)[ \t]*$/;
const flowList = /^([-*]|\d{1,9}\.) (.*)$/;
const continueItem = /^ {2,}\S/;
function boundary(s) {
  const first = s[0];
  return first === undefined
    || ((first === ' ' || first === '\t') && blank.test(s))
    || (first === '#' && !!heading.exec(s)?.[2])
    || (first === '`' && fence.test(s))
    || ((first === '-' || first === '*') && ruler.test(s));
}

export function markdown(body, resolveLink, slug, unique) {
  const lines = body.split('\n');
  const ids = new Set(), toc = [];
  let html = '', excerpt;
  for (let i = 0, len = lines.length; i < len;) {
    const line = lines[i++], first = line[0];
    if (first === undefined || ((first === ' ' || first === '\t') && blank.test(line))) continue;
    let m;
    if (first === '`' && (m = fence.exec(line))) {
      html += m[1] ? '<pre><code class="language-' + m[1] + '">' : '<pre><code>';
      while (i < len && !fenceEnd.test(lines[i])) html += escaped(lines[i++]) + '\n';
      ++i;
      html += '</code></pre>\n';
    } else if (first === '#' && (m = heading.exec(line)) && m[2]) {
      const level = m[1].length, id = unique(slug(m[2]), ids);
      const title = inline(m[2], resolveLink);
      html += '<h' + level + ' id="' + id + '">' + title + '</h' + level + '>\n';
      if (level === 2 || level === 3) toc.push({level, id, html: title});
    } else if ((first === '-' || first === '*') && ruler.test(line)) {
      html += '<hr>\n';
    } else if (first === '>') {
      let p = '';
      let q = line;
      do {
        const content = trim(q.slice(q[1] === ' ' ? 2 : 1));
        if (content) p += p ? '\n' + content : content;
      } while (i < len && (q = lines[i])[0] === '>' && ++i);
      html += p ? '<blockquote>\n<p>' + inline(p, resolveLink) + '</p>\n</blockquote>\n' : '<blockquote>\n</blockquote>\n';
    } else if ((first === '-' || first === '*' || (first >= '0' && first <= '9')) && (m = flowList.exec(line))) {
      const ordered = m[1].length > 1, tag = ordered ? 'ol' : 'ul', start = ordered ? Number(m[1].slice(0, -1)) : 1;
      html += start === 1 ? '<' + tag + '>\n' : '<ol start="' + start + '">\n';
      let item = trim(m[2]);
      while (i < len) {
        const q = lines[i], next = flowList.exec(q);
        if (next && (next[1].length > 1) === ordered) {
          html += '<li>' + inline(item, resolveLink) + '</li>\n';
          item = trim(next[2]);
        } else if (continueItem.test(q)) {
          item += '\n' + trim(q);
        } else break;
        ++i;
      }
      html += '<li>' + inline(item, resolveLink) + '</li>\n</' + tag + '>\n';
    } else {
      let p = trim(line);
      while (i < len && !boundary(lines[i])) p += '\n' + trim(lines[i++]);
      const rendered = inline(p, resolveLink);
      excerpt ??= rendered;
      html += '<p>' + rendered + '</p>\n';
    }
  }
  return {html, toc, excerpt: excerpt ?? ''};
}
