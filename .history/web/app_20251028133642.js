let glossary = [];

async function loadGlossary() {
  try {
    const resp = await fetch('data/glossary.json');
    glossary = await resp.json();
    console.log('Loaded glossary', glossary.length);
  } catch (err) {
    document.getElementById('results').innerText = 'Impossible de charger data/glossary.json. Exécutez le parseur (tools/parse_glossary.py) puis servez ce dossier via un serveur HTTP.';
    console.error(err);
  }
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
