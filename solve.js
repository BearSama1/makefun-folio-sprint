// Fold a site's sources into their published records, then resolve links and render.
// All derived state belongs to one invocation; the input stays unchanged.
import {front} from './front.js';
import {markdown} from './markdown.js';
import {templates} from './templates.js';

const months = 'January February March April May June July August September October November December'.split(' ');
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const reserved = ['posts','tags','page'];

function slugify(s) {
  if (/[^\x00-\x7f]/.test(s)) s = s.normalize('NFKD').replace(/\p{M}+/gu,'');
  // Remove non-ASCII before lowercasing: un-decomposed letters must never case-fold to ASCII.
  let text = s.replace(/[^A-Za-z0-9]+/g,'-');
  if (text[0] === '-') text = text.slice(1);
  text = text.slice(0,64);
  if (text.endsWith('-')) text = text.slice(0,-1);
  return text.toLowerCase() || 'untitled';
}
function uniqueSlug(base, seen) {
  let s = base;
  if (seen.has(s)) { let n=2; do {s=base+'-'+n++;} while (seen.has(s)); }
  seen.add(s);
  return s;
}
function relate(dir, rel) {
  if (!rel) return null;
  const stack = dir ? dir.split('/') : [];
  for (const part of rel.split('/')) {
    if (!part || part === '.') continue;
    if (part !== '..') stack.push(part);
    else if (!stack.length) return null;
    else stack.pop();
  }
  return stack.join('/');
}

export function run(input) {
  const report = [], engine = templates(input.templates,report);
  const base = input.site.base_url.replace(/\/+$/,'');
  const all=[], posts=[], statics=[], pathToURL=new Map(), dirs=new Map(), broken=new Set();
  const site = {title:input.site.title, base_url:base};
  const slugMemo = new Map();
  const slug = (s) => {let r=slugMemo.get(s); if(r===undefined){r=slugify(s);slugMemo.set(s,r);}return r;};
  const files = input.files.slice().sort((a,b)=>cmp(a.path,b.path));
  for (const {path,content} of files) {
    if (!path.endsWith('.md')) {statics.push({path,content});pathToURL.set(path,base+'/'+path); continue;}
    const fm = front(content.indexOf('\r')<0 ? content : content.replace(/\r\n?/g,'\n'));
    const d = fm.data;
    const post = path.startsWith('posts/');
    const layout = d && (d.layout ?? (post?'post':'page'));
    let why = fm.error;
    if (why===undefined) {
      if (path.startsWith('page/') || path.startsWith('tags/')) why = path.slice(0,path.indexOf('/')+1)+" is the generator's own";
      else if (post && d.date === undefined) why = 'a post needs a date';
      else if (!engine.has(layout)) why = 'layout "'+layout+'" is no template that parses';
    }
    if (why!==undefined) {report.push('refused '+path+': '+why);continue;}
    if (d.draft) {report.push('draft '+path);continue;}
    const cut = path.lastIndexOf('/'), dir = cut<0?'':path.slice(0,cut);
    const bucket = post?'posts':dir;
    let seen=dirs.get(bucket); if(!seen){seen=new Set(bucket===''?reserved:[]);dirs.set(bucket,seen);}
    const id=uniqueSlug(d.slug ?? slug(d.title),seen), out=(bucket ? bucket+'/' : '')+id;
    const url=base+'/'+out+'/';
    const s={path,dir,out,url,id,d,layout,post,body:fm.body,card:null,link:null,md:null,index:0};
    all.push(s); if(post)posts.push(s);
    pathToURL.set(path,url);
  }
  posts.sort((a,b)=>cmp(b.d.date,a.d.date)||cmp(a.id,b.id));
  const groups = new Map();
  function attach(s, isPost) {
    const dt=s.d.date || '';
    const pretty=dt ? +dt.slice(8)+' '+months[+dt.slice(5,7)-1]+' '+dt.slice(0,4):'';
    const rec={title:s.d.title,url:s.url,date:dt,date_long:pretty};
    s.link=rec;
    const tags=[];
    if(s.d.tags) {
      const own=new Set();
      for (const name of s.d.tags) {
        const id=slug(name);
        if(own.has(id))continue;
        own.add(id);
        let g=groups.get(id);
        if(!g && isPost){g={brief:{name,slug:id,url:base+'/tags/'+id+'/'},posts:[]};groups.set(id,g);}
        tags.push(g?g.brief:{name,slug:id,url:''});
        if(isPost)g.posts.push(s);
      }
    }
    // Count one match per word in the source body, before Markdown interpretation.
    const words = s.body.match(/\S+/g);
    s.card={title:rec.title,url:rec.url,date:dt,date_long:pretty,summary:s.d.summary??'',excerpt:'',reading_minutes:Math.max(1,Math.ceil((words ? words.length:0)/200)),tags};
  }
  for(let i=0;i<posts.length;i++){posts[i].index=i;attach(posts[i],true);}
  for(const s of all) {
    if(!s.post)attach(s,false);
    const link = (target)=>{
      if(target[0]==='/'||target[0]==='#'||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target))return target;
      const mark=target.indexOf('#'), rel=mark<0?target:target.slice(0,mark);
      const route=pathToURL.get(relate(s.dir,rel));
      if(route!==undefined)return mark<0?route:route+target.slice(mark);
      broken.add('broken-link '+s.path+' -> '+target);return target;
    };
    const md=s.md=markdown(s.body,link,slug,uniqueSlug);
    s.card.excerpt=md.excerpt;
  }
  const groupsSorted=[...groups.values()].sort((a,b)=>b.posts.length-a.posts.length || cmp(a.brief.slug,b.brief.slug));
  const tags=groupsSorted.map(g=>({...g.brief,count:g.posts.length}));
  const recent=posts.slice(0,input.site.recent).map(p=>p.card);
  const render=(name,values)=>engine.render(name,{site,tags,recent,...values});
  const tree={};
  for(const s of all) {
    const page={ ...s.card,slug:s.id,content:s.md.html,toc:s.md.toc,
      newer:s.post && s.index>0 ? posts[s.index-1].link:null,
      older:s.post && s.index+1<posts.length ? posts[s.index+1].link:null,is_post:s.post };
    tree[s.out+'/index.html']=render(s.layout,{page});
  }
  const pageSize=input.site.per_page, total=Math.max(1,Math.ceil(posts.length/pageSize));
  const pageURL=n=>n===1?base+'/':base+'/page/'+n+'/';
  if(engine.has('index')) for (let n=1;n<=total;n++){
    const pager={number:n,total,url:pageURL(n),newer_url:n===1?'':pageURL(n-1),older_url:n===total?'':pageURL(n+1)};
    tree[n===1?'index.html':'page/'+n+'/index.html']=render('index',{pager,posts:posts.slice((n-1)*pageSize,n*pageSize).map(p=>p.card)});
  }
  if(engine.has('tag')) for(const g of groupsSorted) {
    const tag={...g.brief,count:g.posts.length,posts:g.posts.map(p=>p.card)};
    tree['tags/'+g.brief.slug+'/index.html']=render('tag',{tag});
  }
  if(engine.has('tags'))tree['tags/index.html']=render('tags',{});
  for(const {path,content} of statics) {
    if(Object.hasOwn(tree,path))report.push('shadowed '+path+': a built page has its path');
    else tree[path]=content;
  }
  for(const issue of broken) report.push(issue);
  report.sort();
  report.push('built '+(all.length-posts.length)+' pages, '+posts.length+' posts, '+groups.size+' tags and '+statics.length+' static files');
  tree['build-report.txt']=report.join('\n')+'\n';
  return tree;
}
