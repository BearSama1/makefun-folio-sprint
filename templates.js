// Compile the makefun-site template dialect into reusable, data-only render plans.
const own = Object.hasOwn;
const pathPattern = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const forPattern = /^for ([A-Za-z_]\w*) in (\S+)$/;
const ifPattern = /^if (not )?(\S+)$/;
const includePattern = /^include "([a-z0-9-]+)"$/;
const lineSpace = /^[ \t]*$/;
const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const htmlSpecial = /[&<>"']/g;
const entityFor = (ch) => htmlEntities[ch];

function stringify(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (!Array.isArray(v)) return '';
  return v.map(stringify).join(', ');
}

function rootValue(vars, frame, first) {
  while (frame !== null) {
    if (first === 'loop') return frame.loop;
    if (first === frame.name) return frame.value;
    frame = frame.outer;
  }
  return own(vars, first) ? vars[first] : undefined;
}

function pathReader(path) {
  const split = path.split('.');
  const first = split[0];
  const getter = split.length === 1
    ? (vars, frame) => rootValue(vars, frame, first)
    : (vars, frame) => descend(rootValue(vars, frame, first));
  getter.first = first;
  return getter;

  function descend(value) {
    for (let i = 1; i < split.length; i++) {
      if (value === null || typeof value !== 'object' || !own(value, split[i])) return undefined;
      value = value[split[i]];
    }
    return value;
  }
}

class SyntaxFault extends Error {}

function compile(src) {
  const invalid = (message) => { throw new SyntaxFault(message); };
  const get = (p) => {
    if (!pathPattern.test(p)) invalid(JSON.stringify(p) + ' is not a path');
    return pathReader(p);
  };
  // Validate interpolation tokens before any structural tags, so an earlier tag
  // fault does not mask a later malformed interpolation.
  const lexemes = [];
  const opening = /\{[{%]/g;
  let pos = 0;
  for (let m; (m = opening.exec(src)) !== null;) {
    const i = m.index;
    const tag = m[0] === '{%';
    const raw = !tag && src[i + 2] === '{';
    const first = i + (raw ? 3 : 2);
    const closer = tag ? '%}' : raw ? '}}}' : '}}';
    const j = src.indexOf(closer, first);
    if (j < 0) invalid('a ' + (tag ? '{%' : raw ? '{{{' : '{{') + ' is not closed');
    let start = i;
    let next = j + closer.length;
    if (tag) {
      const bol = src.lastIndexOf('\n', i - 1) + 1;
      const eol = src.indexOf('\n', next);
      if (lineSpace.test(src.slice(bol, i)) && lineSpace.test(src.slice(next, eol < 0 ? src.length : eol))) {
        start = bol;
        next = eol < 0 ? src.length : eol + 1;
      }
    }
    if (start > pos) lexemes.push(src.slice(pos, start));
    const content = src.slice(first, j).trim();
    lexemes.push(tag ? { tag: content } : { get: get(content), raw });
    opening.lastIndex = pos = next;
  }
  if (pos < src.length) lexemes.push(src.slice(pos));

  const root = [];
  let body = root;
  const stack = [];
  for (const tok of lexemes) {
    if (typeof tok === 'string' || tok.get) { body.push(tok); continue; }
    const directive = tok.tag;
    const current = stack[stack.length - 1];
    let m;
    if ((m = forPattern.exec(directive))) {
      const node = { kind: 'for', name: m[1], get: get(m[2]), yes: [] };
      body.push(node);
      stack.push({ node, outer: body });
      body = node.yes;
    } else if ((m = ifPattern.exec(directive))) {
      const node = { kind: 'if', invert: m[1] !== undefined, get: get(m[2]), yes: [] };
      body.push(node);
      stack.push({ node, outer: body });
      body = node.yes;
    } else if (directive === 'else') {
      if (current?.node.kind !== 'if' || current.node.no) invalid('an else outside an if');
      body = current.node.no = [];
    } else if (directive === 'endfor' || directive === 'endif') {
      const kind = directive.slice(3);
      if (current?.node.kind !== kind) invalid('an ' + directive + ' with no open ' + kind);
      body = current.outer;
      stack.pop();
    } else if ((m = includePattern.exec(directive))) {
      body.push({ kind: 'include', name: m[1] });
    } else {
      invalid('{% ' + directive + ' %} is not a tag');
    }
  }
  if (stack.length) invalid('a ' + stack[stack.length - 1].node.kind + ' is not closed');
  return root;
}

export function templates(sources, report) {
  const plans = new Map();
  for (const name of Object.keys(sources).sort()) {
    try {
      plans.set(name, compile(sources[name]));
    } catch (error) {
      if (!(error instanceof SyntaxFault)) throw error;
      report.push('template "' + name + '": ' + error.message);
    }
  }

  // For an include, compute the root names that may affect its output. A
  // loop introduces two local names, and an include at budget 0 reads none.
  // Results are scoped to this build and keyed on the exact visible values;
  // generated arrays/records are never mutated during rendering.
  const freeNames = new WeakMap();
  function dependencies(code, budget) {
    let depths = freeNames.get(code);
    if (depths === undefined) freeNames.set(code, depths = []);
    if (depths[budget]) return depths[budget];
    const names = new Set();
    for (const op of code) {
      if (typeof op === 'string') continue;
      if (op.get) names.add(op.get.first);
      if (op.kind === 'for') {
        for (const name of dependencies(op.yes, budget))
          if (name !== 'loop' && name !== op.name) names.add(name);
      } else if (op.kind === 'if') {
        for (const name of dependencies(op.yes, budget)) names.add(name);
        if (op.no) for (const name of dependencies(op.no, budget)) names.add(name);
      } else if (op.kind === 'include' && budget > 0) {
        const included = plans.get(op.name);
        if (included) for (const name of dependencies(included, budget - 1)) names.add(name);
      }
    }
    depths[budget] = names;
    return names;
  }

  const shared = new WeakMap();
  const constantKey = Symbol();
  function include(code, root, frame, depth) {
    let levels = shared.get(code);
    if (!levels) shared.set(code, levels = []);
    let cache = levels[depth];
    if (cache === undefined) {
      const deps = dependencies(code, 8 - depth);
      levels[depth] = cache = deps.size <= 2 && !deps.has('loop')
        ? { names: [...deps], rendered: new Map(), entries: 0 } : false;
    }
    if (!cache) return evaluate(code, root, frame, depth);
    const names = cache.names;
    const first = names.length ? rootValue(root, frame, names[0]) : constantKey;
    const key = names.length === 2 ? rootValue(root, frame, names[1]) : first;
    let dictionary = cache.rendered;
    if (names.length === 2) {
      dictionary = dictionary.get(first);
      if (!dictionary) {
        if (cache.entries >= 2048) return evaluate(code, root, frame, depth);
        cache.rendered.set(first, dictionary = new Map());
      }
    }
    let html = dictionary.get(key);
    if (html === undefined) {
      html = evaluate(code, root, frame, depth);
      if (cache.entries < 2048) {
        dictionary.set(key, html);
        cache.entries++;
      }
    }
    return html;
  }

  function evaluate(code, root, local, depth) {
    let out = '';
    for (let j = 0; j < code.length; j++) {
      const op = code[j];
      if (typeof op === 'string') { out += op; continue; }
      switch (op.kind) {
        case 'if': {
          const v = op.get(root, local);
          // In particular NaN is true in the reference dialect.
          const pass = Array.isArray(v) ? v.length !== 0 : v != null && v !== false && v !== '' && v !== 0;
          const branch = pass !== op.invert ? op.yes : op.no;
          if (branch) out += evaluate(branch, root, local, depth);
          break;
        }
        case 'for': {
          const list = op.get(root, local);
          if (!Array.isArray(list)) break;
          const length = list.length;
          const f = { name: op.name, outer: local, value: undefined, loop: { index: 0, first: true, last: false, length } };
          for (let i = 0; i < length; i++) {
            if (!(i in list)) continue;
            f.value = list[i];
            f.loop.index = i + 1;
            f.loop.first = i === 0;
            f.loop.last = i + 1 === length;
            out += evaluate(op.yes, root, f, depth);
          }
          break;
        }
        case 'include': {
          const includeCode = depth < 8 ? plans.get(op.name) : undefined;
          if (includeCode) out += include(includeCode, root, local, depth + 1);
          break;
        }
        default: {
          const str = stringify(op.get(root, local));
          out += op.raw || str.length === 0 ? str : str.replace(htmlSpecial, entityFor);
          break;
        }
      }
    }
    return out;
  }

  return {
    has(name) { return plans.has(name); },
    render(name, vars) {
      const code = plans.get(name);
      return code === undefined ? null : evaluate(code, vars, null, 0);
    },
  };
}
