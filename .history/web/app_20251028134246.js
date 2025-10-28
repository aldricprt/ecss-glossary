let glossary = [];

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

function mkResult(item) {
  const div = document.createElement('div');
  div.className = 'item';
  const h = document.createElement('h3');
  h.textContent = `${item.term} ${item.id ? '('+item.id+')' : ''}`;
  const small = document.createElement('small');
  small.textContent = item.type;
  h.appendChild(document.createTextNode(' '));
  h.appendChild(small);
  const p = document.createElement('p');
  p.textContent = item.definition;
  div.appendChild(h);
  div.appendChild(p);
  return div;
}

function search(q, filter) {
  if (!q) return [];
  const s = q.trim().toLowerCase();
  return glossary.filter(it => {
    if (filter && filter !== 'all' && it.type !== filter) return false;
    return it.term.toLowerCase().includes(s) || it.definition.toLowerCase().includes(s);
  }).slice(0, 200);
}

function render(results) {
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!results || results.length === 0) {
    container.textContent = 'Aucun résultat.';
    return;
  }
  for (const r of results) {
    container.appendChild(mkResult(r));
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
