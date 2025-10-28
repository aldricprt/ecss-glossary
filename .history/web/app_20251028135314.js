let glossary = [];
let fuse = null;

async function tryFetch(path){
  try{
    const resp = await fetch(path);
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }catch(e){
    return null;
  }
}

async function loadGlossary() {
  // Try common locations so the frontend works whether you serve the project root
  // or only the web/ folder.
  const candidates = ['data/glossary.json', '../data/glossary.json', '/data/glossary.json'];
  for(const p of candidates){
    const j = await tryFetch(p);
    if(j){
      glossary = j;
      console.log('Loaded glossary from', p, glossary.length);
      // build Fuse index
      try{
        fuse = new Fuse(glossary, {
          keys: [
            { name: 'term', weight: 0.8 },
            { name: 'definition', weight: 0.4 }
          ],
          includeMatches: true,
          threshold: 0.35,
          ignoreLocation: true,
          minMatchCharLength: 1
        });
      }catch(e){
        console.warn('Fuse initialization failed, search will fallback to simple filtering', e);
        fuse = null;
      }
      return;
    }
  }

  // If we get here, none of the paths worked
  const msg = `Impossible de charger data/glossary.json. Assurez-vous d'avoir exécuté le parseur (tools/parse_glossary.py) et de servir le projet via un serveur HTTP. Par exemple, depuis la racine du projet :\n\n  cd /path/to/ECSS\n  python3 -m http.server 8000\n\nPuis ouvrez http://localhost:8000/web/`;
  const el = document.getElementById('results');
  el.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = msg;
  el.appendChild(pre);
  console.error('Could not load glossary.json from any candidate path');
}

function escapeHtml(s){
  return s.replace(/[&<>"]+/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[c]));
}

function highlightWithIndices(text, indices){
  if(!indices || indices.length===0) return escapeHtml(text);
  // indices: array of [start, end] (inclusive)
  indices.sort((a,b)=>a[0]-b[0]);
  let out = '';
  let pos = 0;
  for(const [s,e] of indices){
    const start = Math.max(0, s);
    const end = Math.min(text.length-1, e);
    if(start > pos){
      out += escapeHtml(text.slice(pos, start));
    }
    out += '<mark>' + escapeHtml(text.slice(start, end+1)) + '</mark>';
    pos = end+1;
  }
  if(pos < text.length) out += escapeHtml(text.slice(pos));
  return out;
}

function mkResult(item, matches){
  const div = document.createElement('div');
  div.className = 'item';
  const h = document.createElement('h3');
  const idSuffix = item.id ? ` (${item.id})` : '';
  // find match indices for term and definition
  const mTerm = (matches || []).find(m=>m.key==='term');
  const mDef = (matches || []).find(m=>m.key==='definition');
  const termHtml = highlightWithIndices(item.term, mTerm ? mTerm.indices : []);
  const defHtml = highlightWithIndices(item.definition, mDef ? mDef.indices : []);
  h.innerHTML = `${termHtml}${escapeHtml(idSuffix)} `;
  const small = document.createElement('small');
  small.textContent = item.type;
  h.appendChild(document.createTextNode(' '));
  h.appendChild(small);
  const p = document.createElement('p');
  p.innerHTML = defHtml;
  div.appendChild(h);
  div.appendChild(p);
  return div;
}

function search(q, filter) {
  if (!q) return [];
  if(fuse){
    const raw = fuse.search(q, {limit: 200});
    let results = raw.map(r=>({item: r.item, matches: r.matches}));
    if(filter && filter !== 'all') results = results.filter(r=>r.item.type===filter);
    return results.slice(0,200);
  }
  // fallback to simple filter
  const s = q.trim().toLowerCase();
  return glossary.filter(it => {
    if (filter && filter !== 'all' && it.type !== filter) return false;
    return it.term.toLowerCase().includes(s) || it.definition.toLowerCase().includes(s);
  }).slice(0, 200).map(it=>({item:it, matches:[]}));
}

function render(results) {
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!results || results.length === 0) {
    container.textContent = 'No results.';
    return;
  }
  for (const r of results) {
    if(r.item) container.appendChild(mkResult(r.item, r.matches));
    else container.appendChild(mkResult(r));
  }
}

function debounce(fn, wait=200){
  let t = null;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), wait);
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await loadGlossary();
  const q = document.getElementById('q');
  const filter = document.getElementById('filter');
  const doSearch = debounce(()=>{
    const results = search(q.value, filter.value);
    render(results);
  }, 150);
  q.addEventListener('input', doSearch);
  filter.addEventListener('change', doSearch);
});
