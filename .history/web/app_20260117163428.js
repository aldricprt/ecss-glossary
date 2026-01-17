let glossary = [];
let fuse = null;
let usingApi = false;
let currentView = 'glossary'; // 'glossary' or 'diagrams' or 'equations'
let doSearch = null; // Will be defined in DOMContentLoaded
let selectedTags = new Set();
let imagesData = [];
let equationsData = [];

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
  // Prefer the local API if available
  const api = await tryFetch('/api/terms');
  if(Array.isArray(api)){
    glossary = api;
    usingApi = true;
    buildIndex();
    return;
  }

  // Try common static locations as a fallback
  const candidates = ['data/glossary.json', '../data/glossary.json', '/data/glossary.json'];
  for(const p of candidates){
    const j = await tryFetch(p);
    if(j){
      glossary = j;
      usingApi = false;
      console.log('Loaded glossary from', p, glossary.length);
      buildIndex();
      return;
    }
  }

  const el = document.getElementById('results');
  el.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = 'No data available. Start the server with `python3 server.py` or copy a static JSON to `web/data/glossary.json`.';
  el.appendChild(pre);
  console.error('Could not load glossary from API or static candidates');
}

function buildIndex(){
  try{
    fuse = new Fuse(glossary, {
      keys: [
        { name: 'term', weight: 0.8 },
        { name: 'definition', weight: 0.4 },
        { name: 'abbreviation', weight: 0.9 }
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
}

function escapeHtml(s){
  return s.replace(/[&<>"]+/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[c]));
}

function normalizeMatches(text, indices, maxSegments=2){
  if(!indices || indices.length===0) return [];
  // merge overlapping / adjacent ranges
  indices.sort((a,b)=>a[0]-b[0]);
  const merged = [];
  for(const [s,e] of indices){
    if(!merged.length || s > merged[merged.length-1][1] + 1){
      merged.push([s,e]);
    }else{
      merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
    }
  }
  // keep only the first segments to avoid visual noise
  const limited = merged.slice(0, maxSegments);
  // expand to word boundaries for readability
  return limited.map(([s,e])=>{
    let ns = Math.max(0, s);
    let ne = Math.min(text.length-1, e);
    while(ns>0 && /[\w]/.test(text[ns-1])) ns--;
    while(ne+1<text.length && /[\w]/.test(text[ne+1])) ne++;
    return [ns, ne];
  });
}

function highlightWithIndices(text, indices){
  const ranges = normalizeMatches(text, indices, 2);
  if(ranges.length===0) return escapeHtml(text);
  let out = '';
  let pos = 0;
  for(const [s,e] of ranges){
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
  // find match indices for term and definition
  const mTerm = (matches || []).find(m=>m.key==='term');
  const mDef = (matches || []).find(m=>m.key==='definition');
  const termHtml = highlightWithIndices(item.term, mTerm ? mTerm.indices : []);
  const defHtml = highlightWithIndices(item.definition, mDef ? mDef.indices : []);
  // Do not display the internal id in the list to avoid long UUID clutter
  h.innerHTML = `${termHtml}`;
  const small = document.createElement('small');
  if(item.abbreviation) small.textContent = item.abbreviation;
  h.appendChild(document.createTextNode(' '));
  h.appendChild(small);
  const p = document.createElement('p');
  p.innerHTML = defHtml;
  div.appendChild(h);
  div.appendChild(p);
  // Display tags if present
  if(item.tags && item.tags.length > 0){
    const tagsDiv = document.createElement('div');
    tagsDiv.style.marginBottom = '8px';
    tagsDiv.style.display = 'flex';
    tagsDiv.style.gap = '6px';
    tagsDiv.style.flexWrap = 'wrap';
    for(const tag of item.tags){
      const tagEl = document.createElement('span');
      tagEl.style.backgroundColor = 'rgba(77,161,255,0.15)';
      tagEl.style.color = 'var(--accent)';
      tagEl.style.padding = '2px 8px';
      tagEl.style.borderRadius = '4px';
      tagEl.style.fontSize = '12px';
      tagEl.style.fontWeight = '500';
      tagEl.textContent = tag;
      tagsDiv.appendChild(tagEl);
    }
    div.appendChild(tagsDiv);
  }
  // action buttons (edit / delete)
  const actions = document.createElement('div');
  actions.className = 'itemActions';
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    openEditor(item);
  });
  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    if(confirm(`Delete "${item.term}"?`)) deleteTerm(item.id);
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  div.appendChild(actions);
  // open modal when clicking an item
  div.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    openModal(item, matches);
  });
  return div;
}

// Editor (add/update)
function openEditor(item){
  const editor = document.getElementById('editor');
  const title = document.getElementById('editorTitle');
  const term = document.getElementById('fieldTerm');
  const abbr = document.getElementById('fieldAbbreviation');
  const def = document.getElementById('fieldDefinition');
  const tags = document.getElementById('fieldTags');
  const idf = document.getElementById('fieldId');
  editor.classList.remove('hidden');
  editor.setAttribute('aria-hidden','false');
  if(item){
    title.textContent = 'Edit entry';
    term.value = item.term || '';
    abbr.value = item.abbreviation || '';
    def.value = item.definition || '';
    tags.value = item.tags && item.tags.length > 0 ? item.tags.join(', ') : '';
    idf.value = item.id || '';
  }else{
    title.textContent = 'Add a new entry';
    term.value = '';
    abbr.value = '';
    def.value = '';
    tags.value = '';
    idf.value = '';
  }
  document.getElementById('fieldTerm').focus();
}

function closeEditor(){
  const editor = document.getElementById('editor');
  editor.classList.add('hidden');
  editor.setAttribute('aria-hidden','true');
}

async function saveTerm(data){
  try{
    const resp = await fetch('/api/terms', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    if(!resp.ok) throw new Error('Failed to save');
    return await resp.json();
  }catch(e){
    alert('Could not save entry to API. Is the server running?');
    return null;
  }
}

async function updateTermAPI(id, data){
  try{
    const resp = await fetch(`/api/terms/${id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    if(!resp.ok) throw new Error('Failed to update');
    return await resp.json();
  }catch(e){
    alert('Could not update entry to API. Is the server running?');
    return null;
  }
}

async function deleteTerm(id){
  try{
    const resp = await fetch(`/api/terms/${id}`, {method:'DELETE'});
    if(!resp.ok) throw new Error('Delete failed');
    await loadGlossary();
    const q = document.getElementById('q');
    render(search(q.value));
  }catch(e){
    alert('Could not delete entry. Is the server running?');
  }
}

// Modal handling
function openModal(item, matches){
  const modal = document.getElementById('modal');
  const title = document.getElementById('modalTitle');
  const meta = document.getElementById('modalMeta');
  const body = document.getElementById('modalBody');
  // Show term as title, display type and a short id in modal meta (with copy button)
  title.textContent = item.term || '';
  const shortId = item.id ? item.id.slice(0,8) : '';
  meta.innerHTML = '';
  const abbrSpan = document.createElement('span');
  if(item.abbreviation){
    abbrSpan.textContent = `Abbr: ${item.abbreviation}`;
    abbrSpan.style.marginRight = '12px';
    meta.appendChild(abbrSpan);
  }
  if(item.id){
    const idSpan = document.createElement('span');
    idSpan.textContent = `ID: ${shortId}`;
    idSpan.style.fontFamily = 'monospace';
    idSpan.style.marginRight = '8px';
    meta.appendChild(idSpan);
    const copyIdBtn = document.createElement('button');
    copyIdBtn.textContent = 'Copy ID';
    copyIdBtn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      navigator.clipboard && navigator.clipboard.writeText(item.id).then(()=>{
        copyIdBtn.textContent = 'Copied';
        setTimeout(()=>copyIdBtn.textContent = 'Copy ID', 1200);
      }).catch(()=>{ copyIdBtn.textContent = 'Copy failed'; });
    });
    meta.appendChild(copyIdBtn);
  }
  // highlight in modal as well
  const mTerm = (matches || []).find(m=>m.key==='term');
  const mDef = (matches || []).find(m=>m.key==='definition');
  const defHtml = highlightWithIndices(item.definition, mDef ? mDef.indices : []);
  body.innerHTML = defHtml;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  // attach button handlers
  const closeBtn = document.getElementById('closeBtn');
  const copyBtn = document.getElementById('copyBtn');
  closeBtn.onclick = closeModal;
  copyBtn.onclick = ()=>{
    navigator.clipboard && navigator.clipboard.writeText(item.definition).then(()=>{
      copyBtn.textContent = 'Copied';
      setTimeout(()=>copyBtn.textContent = 'Copy definition', 1500);
    }).catch(()=>{
      copyBtn.textContent = 'Copy failed';
    });
  };
}

function closeModal(){
  const modal = document.getElementById('modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
}

// close when clicking overlay
document.addEventListener('DOMContentLoaded', ()=>{
  const overlay = document.getElementById('modalOverlay');
  overlay && overlay.addEventListener('click', closeModal);
  // close on ESC
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') closeModal();
    // Ctrl/Cmd+K focus shortcut
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
      e.preventDefault();
      const q = document.getElementById('q');
      q && (q.focus(), q.select());
    }
  });
});

function search(q) {
  // If no query but tags are selected, return all items (tag filter will be applied)
  if (!q) {
    if (selectedTags.size > 0) {
      return glossary.map(it => ({item: it, matches: []}));
    }
    return [];
  }
  if(fuse){
    const raw = fuse.search(q, {limit: 200});
    let results = raw.map(r=>({item: r.item, matches: r.matches}));
    return results.slice(0,200);
  }
  // fallback to simple filter across term, definition, abbreviation
  const s = q.trim().toLowerCase();
  return glossary.filter(it => {
    return (it.term || '').toLowerCase().includes(s) || (it.definition || '').toLowerCase().includes(s) || (it.abbreviation || '').toLowerCase().includes(s);
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

// Tag filtering
function getAllUniqueTags(){
  const tags = new Set();
  // Glossary
  for(const item of glossary){
    if(item.tags && Array.isArray(item.tags)) for(const t of item.tags) tags.add(t);
  }
  // Diagrams
  for(const img of imagesData){
    if(img.tags && Array.isArray(img.tags)) for(const t of img.tags) tags.add(t);
  }
  // Equations
  for(const eq of equationsData){
    if(eq.tags && Array.isArray(eq.tags)) for(const t of eq.tags) tags.add(t);
  }
  return Array.from(tags).sort();
}

function filterByTags(results){
  if(selectedTags.size === 0) return results;
  // Return only results that have ALL selected tags
  return results.filter(r=>{
    const itemTags = new Set(r.item?.tags || r.tags || []);
    for(const tag of selectedTags){
      if(!itemTags.has(tag)) return false;
    }
    return true;
  });
}

function renderTagFiltersInto(containerId, clearBtnId){
  const container = document.getElementById(containerId);
  if(!container) return;
  const tags = getAllUniqueTags();
  container.innerHTML = '';
  for(const tag of tags){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tag;
    btn.className = selectedTags.has(tag) ? 'tagFilterBtn active' : 'tagFilterBtn';
    btn.addEventListener('click', ()=>{
      if(selectedTags.has(tag)){
        selectedTags.delete(tag);
        btn.classList.remove('active');
      }else{
        selectedTags.add(tag);
        btn.classList.add('active');
      }
      // Trigger appropriate re-render based on current view
      if(currentView === 'glossary' && doSearch){
        doSearch();
      }else if(currentView === 'diagrams'){
        const filtered = filterImagesByTags(imagesData);
        renderGalleryIn('diagramsGallery', filtered);
      }else if(currentView === 'equations'){
        renderEquationsList(equationsData);
      }
      updateClearTagsButton(clearBtnId);
    });
    container.appendChild(btn);
  }
  updateClearTagsButton(clearBtnId);
}

function updateClearTagsButton(clearBtnId='clearTagFilters'){
  const btn = document.getElementById(clearBtnId);
  if(!btn) return;
  btn.style.display = selectedTags.size > 0 ? 'inline-block' : 'none';
}

// Tag autocomplete setup
function setupTagAutocompleteFor(inputId, suggestionsContainerId){
  const input = document.getElementById(inputId);
  const suggestionsContainer = document.getElementById(suggestionsContainerId);
  if(!input || !suggestionsContainer) return;
  
  let currentFocus = -1;
  
  input.addEventListener('input', ()=>{
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // Find the current tag being typed (after last comma before cursor)
    const beforeCursor = value.substring(0, cursorPos);
    const lastComma = beforeCursor.lastIndexOf(',');
    const currentTag = beforeCursor.substring(lastComma + 1).trim().toLowerCase();
    
    // Hide suggestions if not typing
    if(!currentTag || currentTag.length < 1){
      suggestionsContainer.classList.add('hidden');
      return;
    }
    
    // Get all existing tags
    const existingTags = getAllUniqueTags();
    
    // Filter tags that match the current input
    const matches = existingTags.filter(tag => 
      tag.toLowerCase().startsWith(currentTag) && 
      tag.toLowerCase() !== currentTag
    );
    
    // Show suggestions
    if(matches.length > 0){
      suggestionsContainer.innerHTML = '';
      matches.forEach((tag, idx) => {
        const item = document.createElement('div');
        item.className = 'tag-suggestion-item';
        item.textContent = tag;
        item.addEventListener('click', ()=>{
          // Replace the current tag being typed with the selected one
          const beforeTag = value.substring(0, lastComma + 1);
          const afterCursor = value.substring(cursorPos);
          const separator = beforeTag.trim() ? ' ' : '';
          input.value = beforeTag + separator + tag + (afterCursor.startsWith(',') ? '' : ', ') + afterCursor.trimStart();
          suggestionsContainer.classList.add('hidden');
          input.focus();
        });
        suggestionsContainer.appendChild(item);
      });
      suggestionsContainer.classList.remove('hidden');
      currentFocus = -1;
    }else{
      suggestionsContainer.classList.add('hidden');
    }
  });
  
  // Keyboard navigation
  input.addEventListener('keydown', (e)=>{
    const items = suggestionsContainer.querySelectorAll('.tag-suggestion-item');
    if(!items.length) return;
    
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      currentFocus++;
      if(currentFocus >= items.length) currentFocus = 0;
      setActive(items);
    }else if(e.key === 'ArrowUp'){
      e.preventDefault();
      currentFocus--;
      if(currentFocus < 0) currentFocus = items.length - 1;
      setActive(items);
    }else if(e.key === 'Enter' && currentFocus > -1){
      e.preventDefault();
      items[currentFocus].click();
    }else if(e.key === 'Escape'){
      suggestionsContainer.classList.add('hidden');
    }
  });
  
  function setActive(items){
    items.forEach((item, idx) => {
      if(idx === currentFocus){
        item.classList.add('active');
      }else{
        item.classList.remove('active');
      }
    });
  }
  
  // Close suggestions when clicking outside
  document.addEventListener('click', (e)=>{
    if(e.target !== input && !suggestionsContainer.contains(e.target)){
      suggestionsContainer.classList.add('hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await loadGlossary();
  const q = document.getElementById('q');
  doSearch = debounce(()=>{
    const results = search(q.value);
    const filtered = filterByTags(results);
    render(filtered);
  }, 150);
  q.addEventListener('input', doSearch);
  
  // Clear tag filters button
  const clearTagFiltersBtn = document.getElementById('clearTagFilters');
  if(clearTagFiltersBtn){
    clearTagFiltersBtn.addEventListener('click', ()=>{
      selectedTags.clear();
      renderTagFiltersInto('tagFilterContainer','clearTagFilters');
      doSearch();
    });
  }
  
  // Initial render of tag filters
  renderTagFiltersInto('tagFilterContainer','clearTagFilters');
  
  // Tag autocomplete fields
  setupTagAutocompleteFor('fieldTags','tagSuggestions');
  setupTagAutocompleteFor('imgTagsInline','imgTagsInlineSuggestions');
  setupTagAutocompleteFor('imgTags','imgTagsSuggestions');
  setupTagAutocompleteFor('eqTags','eqTagsSuggestions');
  
  // Clear tag filters for diagrams
  const clearDiagBtn = document.getElementById('clearDiagTagFilters');
  if(clearDiagBtn){
    clearDiagBtn.addEventListener('click', ()=>{
      selectedTags.clear();
      renderTagFiltersInto('diagTagFilterContainer','clearDiagTagFilters');
      const filteredImgs = filterImagesByTags(imagesData);
      renderGalleryIn('diagramsGallery', filteredImgs);
    });
  }
  // Clear tag filters for equations
  const clearEqBtn = document.getElementById('clearEqTagFilters');
  if(clearEqBtn){
    clearEqBtn.addEventListener('click', ()=>{
      selectedTags.clear();
      renderTagFiltersInto('eqTagFilterContainer','clearEqTagFilters');
      renderEquationsList(equationsData);
    });
  }
  
  // Menu switching
  const menuGloss = document.getElementById('menuGlossary');
  const menuDiag = document.getElementById('menuDiagrams');
  const menuEq = document.getElementById('menuEquations');
  async function switchView(v){
    currentView = v;
    const g = document.getElementById('glossaryApp');
    const d = document.getElementById('diagramsApp');
    const e = document.getElementById('equationsApp');
    if(v === 'glossary'){
      g.classList.remove('hidden'); g.setAttribute('aria-hidden','false');
      d.classList.add('hidden'); d.setAttribute('aria-hidden','true');
      e.classList.add('hidden'); e.setAttribute('aria-hidden','true');
      menuGloss && menuGloss.classList.add('active');
      menuDiag && menuDiag.classList.remove('active');
      menuEq && menuEq.classList.remove('active');
      // focus search
      const qq = document.getElementById('q'); qq && qq.focus(); qq && qq.select();
    }else if(v === 'diagrams'){
      g.classList.add('hidden'); g.setAttribute('aria-hidden','true');
      d.classList.remove('hidden'); d.setAttribute('aria-hidden','false');
      e.classList.add('hidden'); e.setAttribute('aria-hidden','true');
      menuDiag && menuDiag.classList.add('active');
      menuGloss && menuGloss.classList.remove('active');
      menuEq && menuEq.classList.remove('active');
      // load gallery into inline container
      imagesData = await tryFetch('/api/images') || [];
      renderTagFiltersInto('diagTagFilterContainer','clearDiagTagFilters');
      const filteredImgs = filterImagesByTags(imagesData);
      renderGalleryIn('diagramsGallery', filteredImgs);
    }else if(v === 'equations'){
      g.classList.add('hidden'); g.setAttribute('aria-hidden','true');
      d.classList.add('hidden'); d.setAttribute('aria-hidden','true');
      e.classList.remove('hidden'); e.setAttribute('aria-hidden','false');
      menuEq && menuEq.classList.add('active');
      menuGloss && menuGloss.classList.remove('active');
      menuDiag && menuDiag.classList.remove('active');
      // load and render equations
      equationsData = await tryFetch('/api/equations') || [];
      renderTagFiltersInto('eqTagFilterContainer','clearEqTagFilters');
      renderEquationsList(equationsData);
    }
  }
  menuGloss && menuGloss.addEventListener('click', ()=>switchView('glossary'));
  menuDiag && menuDiag.addEventListener('click', ()=>switchView('diagrams'));
  menuEq && menuEq.addEventListener('click', ()=>switchView('equations'));
  // default view
  switchView('glossary');
  // editor buttons
  document.getElementById('showAdd').addEventListener('click', ()=>openEditor());
  document.getElementById('cancelBtn').addEventListener('click', ()=>closeEditor());
  document.getElementById('addForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const abbrv = document.getElementById('fieldAbbreviation').value.trim();
    const termv = document.getElementById('fieldTerm').value.trim();
    const defv = document.getElementById('fieldDefinition').value.trim();
    const tagsv = document.getElementById('fieldTags').value.trim();
    const idv = document.getElementById('fieldId').value;
    if(!termv || !defv){ alert('Term and definition are required'); return; }
    if(idv){
      const updated = await updateTermAPI(idv, {term:termv, definition:defv, abbreviation: abbrv, tags: tagsv});
      if(updated){ await loadGlossary(); closeEditor(); doSearch(); }
    }else{
      const added = await saveTerm({term:termv, definition:defv, abbreviation: abbrv, tags: tagsv});
      if(added){ await loadGlossary(); closeEditor(); doSearch(); }
    }
  });
  // DB viewer buttons
  const viewBtn = document.getElementById('viewDb');
  viewBtn && viewBtn.addEventListener('click', async ()=>{
    const db = await tryFetch('/api/terms') || await tryFetch('/data/glossary_user.json') || [];
    showDbModal(db);
  });
  // inline diagrams upload handlers (menu-driven)
  const uploadBtnInline = document.getElementById('uploadBtnInline');
  uploadBtnInline && uploadBtnInline.addEventListener('click', async ()=>{
    const fileEl = document.getElementById('imgFileInline');
    const titleEl = document.getElementById('imgTitleInline');
    const tagsEl = document.getElementById('imgTagsInline');
    if(!fileEl.files || fileEl.files.length===0){ alert('Select a file to upload'); return; }
    const f = fileEl.files[0];
    const fd = new FormData();
    fd.append('file', f);
    fd.append('title', titleEl.value || f.name);
    fd.append('tags', (tagsEl && tagsEl.value) ? tagsEl.value : '');
    try{
      const resp = await fetch('/api/images', {method:'POST', body: fd});
      if(!resp.ok) throw new Error('Upload failed');
      const meta = await resp.json();
      // reload gallery
      imagesData = await tryFetch('/api/images') || [];
      const filtered = filterImagesByTags(imagesData);
      renderGalleryIn('diagramsGallery', filtered);
      titleEl.value = '';
      fileEl.value = '';
      if(tagsEl) tagsEl.value = '';
    }catch(e){ alert('Upload failed'); }
  });
  const closeDiag = document.getElementById('closeDiag');
  closeDiag && closeDiag.addEventListener('click', ()=>{
    document.getElementById('diagModal').classList.add('hidden');
    document.getElementById('diagModal').setAttribute('aria-hidden','true');
  });
  const diagOverlay = document.getElementById('diagModalOverlay');
  diagOverlay && diagOverlay.addEventListener('click', ()=>{
    document.getElementById('diagModal').classList.add('hidden');
    document.getElementById('diagModal').setAttribute('aria-hidden','true');
  });
  // upload handler
  const uploadBtn = document.getElementById('uploadBtn');
  uploadBtn && uploadBtn.addEventListener('click', async ()=>{
    const fileEl = document.getElementById('imgFile');
    const titleEl = document.getElementById('imgTitle');
    const tagsEl = document.getElementById('imgTags');
    if(!fileEl.files || fileEl.files.length===0){ alert('Select a file to upload'); return; }
    const f = fileEl.files[0];
    const fd = new FormData();
    fd.append('file', f);
    fd.append('title', titleEl.value || f.name);
    fd.append('tags', (tagsEl && tagsEl.value) ? tagsEl.value : '');
    try{
      const resp = await fetch('/api/images', {method:'POST', body: fd});
      if(!resp.ok) throw new Error('Upload failed');
      const meta = await resp.json();
      // reload gallery
      imagesData = await tryFetch('/api/images') || [];
      const filtered = filterImagesByTags(imagesData);
      renderGallery(filtered);
      titleEl.value = '';
      fileEl.value = '';
      if(tagsEl) tagsEl.value = '';
    }catch(e){ alert('Upload failed'); }
  });
  const closeDb = document.getElementById('closeDb');
  closeDb && closeDb.addEventListener('click', ()=>{
    document.getElementById('dbModal').classList.add('hidden');
    document.getElementById('dbModal').setAttribute('aria-hidden','true');
  });
  const dbOverlay = document.getElementById('dbModalOverlay');
  dbOverlay && dbOverlay.addEventListener('click', ()=>{
    document.getElementById('dbModal').classList.add('hidden');
    document.getElementById('dbModal').setAttribute('aria-hidden','true');
  });
  const downloadBtn = document.getElementById('downloadDb');
  downloadBtn && downloadBtn.addEventListener('click', async ()=>{
    const db = await tryFetch('/api/terms') || await tryFetch('/data/glossary_user.json') || [];
    const dataStr = JSON.stringify(db, null, 2);
    const blob = new Blob([dataStr], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glossary_user.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
});

// Render gallery into an inline container (does not open modal)
function renderGalleryIn(containerId, imgs){
  const gallery = document.getElementById(containerId);
  if(!gallery) return;
  gallery.innerHTML = '';
  const items = Array.isArray(imgs) ? imgs.slice().reverse() : [];
  for(const it of items){
    const card = document.createElement('div');
    card.className = 'diagramCard';
    // thumbnail
    const ext = (it.filename || '').split('.').pop().toLowerCase();
    if(['png','jpg','jpeg','gif','svg'].includes(ext)){
      const img = document.createElement('img');
      img.src = `/images/${it.filename}`;
      img.className = 'diagramThumb';
      card.appendChild(img);
    }else{
      const box = document.createElement('div');
      box.textContent = it.original || it.filename || '';
      box.className = 'diagramFallback';
      card.appendChild(box);
    }
    const t = document.createElement('div'); t.textContent = it.title || ''; t.className='diagramTitle';
    const meta = document.createElement('div'); meta.className='diagramMeta'; meta.textContent = it.uploaded_at ? new Date(it.uploaded_at).toLocaleString() : '';
    // tags badges
    if(it.tags && it.tags.length>0){
      const tagsDiv = document.createElement('div');
      tagsDiv.style.marginTop = '4px';
      tagsDiv.style.display = 'flex';
      tagsDiv.style.gap = '6px';
      tagsDiv.style.flexWrap = 'wrap';
      for(const tag of it.tags){
        const tagEl = document.createElement('span');
        tagEl.style.backgroundColor = 'rgba(77,161,255,0.15)';
        tagEl.style.color = 'var(--accent)';
        tagEl.style.padding = '2px 8px';
        tagEl.style.borderRadius = '4px';
        tagEl.style.fontSize = '12px';
        tagEl.style.fontWeight = '500';
        tagEl.textContent = tag;
        tagsDiv.appendChild(tagEl);
      }
      card.appendChild(tagsDiv);
    }
    const actions = document.createElement('div'); actions.className='diagramActions';
    const openBtn = document.createElement('a'); openBtn.textContent = 'Open'; openBtn.href = `/images/${it.filename}`; openBtn.target='_blank'; openBtn.className='diagramBtn';
    const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.className='diagramBtn';
    delBtn.addEventListener('click', async ()=>{
      if(!confirm('Delete this diagram?')) return;
      try{
        const resp = await fetch(`/api/images/${it.id}`, {method:'DELETE'});
        if(!resp.ok) throw new Error('Delete failed');
        imagesData = await tryFetch('/api/images') || [];
        const filtered = filterImagesByTags(imagesData);
        renderGalleryIn(containerId, filtered);
      }catch(e){ alert('Delete failed'); }
    });
    actions.appendChild(openBtn); actions.appendChild(delBtn);
    card.appendChild(t); card.appendChild(meta); card.appendChild(actions);
    gallery.appendChild(card);
  }
}

function showDbModal(db){
  const modal = document.getElementById('dbModal');
  const container = document.getElementById('dbTableContainer');
  const searchInput = document.getElementById('dbSearch');
  const rowsSelect = document.getElementById('dbRows');
  const sortSelect = document.getElementById('dbSort');
  container.innerHTML = '';

  // keep a working copy
  let items = Array.isArray(db) ? db.slice() : [];
  let filtered = items;
  let page = 1;

  function sortItems(arr, sortType){
    const sorted = arr.slice();
    switch(sortType){
      case 'recent':
        // Sort by updated_at or created_at descending (most recent first)
        sorted.sort((a,b)=>{
          const aTime = a.updated_at || a.created_at || '';
          const bTime = b.updated_at || b.created_at || '';
          return bTime.localeCompare(aTime);
        });
        break;
      case 'oldest':
        // Sort by created_at ascending (oldest first)
        sorted.sort((a,b)=>{
          const aTime = a.created_at || a.updated_at || '';
          const bTime = b.created_at || b.updated_at || '';
          return aTime.localeCompare(bTime);
        });
        break;
      case 'alpha-asc':
        // Sort A-Z by term
        sorted.sort((a,b)=>(a.term||'').localeCompare(b.term||''));
        break;
      case 'alpha-desc':
        // Sort Z-A by term
        sorted.sort((a,b)=>(b.term||'').localeCompare(a.term||''));
        break;
    }
    return sorted;
  }

  function renderTable(){
    const rowsPerPage = parseInt(rowsSelect.value, 10) || 10;
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / rowsPerPage));
    if(page > pages) page = pages;
    const start = (page-1)*rowsPerPage;
    const end = Math.min(total, start + rowsPerPage);

    // build table
    const table = document.createElement('table');
    table.className = 'dbTable';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    const thead = document.createElement('thead');
    const hdr = document.createElement('tr');
    ['Abbreviation','Term','Definition','ID','Actions'].forEach(h=>{
      const th = document.createElement('th');
      th.textContent = h;
      th.style.textAlign = 'left';
      th.style.padding = '8px 10px';
      th.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
      hdr.appendChild(th);
    });
    thead.appendChild(hdr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for(let i=start;i<end;i++){
      const it = filtered[i];
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
      // Type
      const tdType = document.createElement('td'); tdType.textContent = it.abbreviation || ''; tdType.style.padding='8px 10px'; tr.appendChild(tdType);
      // Term
      const tdTerm = document.createElement('td'); tdTerm.textContent = it.term || ''; tdTerm.style.padding='8px 10px'; tdTerm.style.fontWeight='600'; tr.appendChild(tdTerm);
      // Definition (truncate)
      const tdDef = document.createElement('td');
      const defText = it.definition || '';
      tdDef.textContent = defText.length>140 ? defText.slice(0,137)+'...' : defText;
      tdDef.style.padding='8px 10px'; tdDef.style.color='var(--muted)'; tr.appendChild(tdDef);
      // ID (short)
      const tdId = document.createElement('td'); tdId.textContent = it.id ? it.id.slice(0,8) : ''; tdId.style.padding='8px 10px'; tdId.style.fontFamily='monospace'; tr.appendChild(tdId);
      // Actions
      const tdAct = document.createElement('td'); tdAct.style.padding='8px 10px';
      const eBtn = document.createElement('button'); eBtn.textContent='Edit'; eBtn.style.marginRight='8px';
      eBtn.addEventListener('click',(ev)=>{ ev.stopPropagation(); openEditor(it); });
      const dBtn = document.createElement('button'); dBtn.textContent='Delete'; dBtn.addEventListener('click',(ev)=>{ ev.stopPropagation(); if(confirm(`Delete "${it.term}"?`)){ deleteTerm(it.id); // reload
        // update local items then rerender after slight delay to let API complete
        setTimeout(async ()=>{ items = await (tryFetch('/api/terms') || []); applyFiltersAndSort(); }, 250);
      }});
      tdAct.appendChild(eBtn); tdAct.appendChild(dBtn);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // pagination controls
    const pager = document.createElement('div');
    pager.style.display='flex'; pager.style.justifyContent='space-between'; pager.style.alignItems='center'; pager.style.marginTop='10px';
    const left = document.createElement('div'); left.textContent = `Showing ${start+1}-${end} of ${total}`; left.style.color='var(--muted)';
    const right = document.createElement('div');
    const prev = document.createElement('button'); prev.textContent='Prev'; prev.disabled = page<=1; prev.addEventListener('click', ()=>{ page--; renderTable(); });
    const next = document.createElement('button'); next.textContent='Next'; next.disabled = page>=pages; next.addEventListener('click', ()=>{ page++; renderTable(); });
    right.appendChild(prev); right.appendChild(next);
    pager.appendChild(left); pager.appendChild(right);

    container.innerHTML = '';
    container.appendChild(table);
    container.appendChild(pager);
  }

  function filterItems(q){
    const s = (q||'').trim().toLowerCase();
    if(!s) return items.slice();
    return items.filter(it => (it.term || '').toLowerCase().includes(s) || (it.definition || '').toLowerCase().includes(s));
  }

  function applyFiltersAndSort(){
    const searchQuery = searchInput.value;
    const sortType = sortSelect.value;
    // First filter
    let result = filterItems(searchQuery);
    // Then sort
    result = sortItems(result, sortType);
    filtered = result;
    page = 1;
    renderTable();
  }

  // wire inputs
  searchInput.value = '';
  rowsSelect.value = '10';
  sortSelect.value = 'recent';
  searchInput.oninput = applyFiltersAndSort;
  rowsSelect.onchange = ()=>{ page=1; renderTable(); };
  sortSelect.onchange = applyFiltersAndSort;

  // initial render
  applyFiltersAndSort();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}

function showDiagModal(imgs){
  const modal = document.getElementById('diagModal');
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  const items = Array.isArray(imgs) ? imgs.slice().reverse() : [];
  for(const it of items){
    const card = document.createElement('div');
    card.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.00))';
    card.style.border = '1px solid rgba(255,255,255,0.03)';
    card.style.padding = '8px';
    card.style.borderRadius = '8px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '8px';
    // thumbnail
    const ext = (it.filename || '').split('.').pop().toLowerCase();
    if(['png','jpg','jpeg','gif','svg'].includes(ext)){
      const img = document.createElement('img');
      img.src = `/images/${it.filename}`;
      img.style.width = '100%'; img.style.height='110px'; img.style.objectFit='cover'; img.style.borderRadius='6px';
      card.appendChild(img);
    }else{
      const box = document.createElement('div');
      box.textContent = it.original || it.filename || '';
      box.style.minHeight = '110px'; box.style.display='flex'; box.style.alignItems='center'; box.style.justifyContent='center'; box.style.background='#071026'; box.style.borderRadius='6px';
      card.appendChild(box);
    }
    const t = document.createElement('div'); t.textContent = it.title || ''; t.style.fontWeight='600';
    const meta = document.createElement('div'); meta.style.fontSize='12px'; meta.style.color='var(--muted)'; meta.textContent = it.uploaded_at ? new Date(it.uploaded_at).toLocaleString() : '';
    if(it.tags && it.tags.length>0){
      const tagsDiv = document.createElement('div');
      tagsDiv.style.marginTop = '4px';
      tagsDiv.style.display = 'flex';
      tagsDiv.style.gap = '6px';
      tagsDiv.style.flexWrap = 'wrap';
      for(const tag of it.tags){
        const tagEl = document.createElement('span');
        tagEl.style.backgroundColor = 'rgba(77,161,255,0.15)';
        tagEl.style.color = 'var(--accent)';
        tagEl.style.padding = '2px 8px';
        tagEl.style.borderRadius = '4px';
        tagEl.style.fontSize = '12px';
        tagEl.style.fontWeight = '500';
        tagEl.textContent = tag;
        tagsDiv.appendChild(tagEl);
      }
      card.appendChild(tagsDiv);
    }
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const openBtn = document.createElement('a'); openBtn.textContent = 'Open'; openBtn.href = `/images/${it.filename}`; openBtn.target='_blank'; openBtn.style.padding='6px 8px'; openBtn.style.border='1px solid rgba(255,255,255,0.04)'; openBtn.style.borderRadius='6px'; openBtn.style.background='transparent';
    const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.style.padding='6px 8px'; delBtn.addEventListener('click', async ()=>{
      if(!confirm('Delete this diagram?')) return;
      try{
        const resp = await fetch(`/api/images/${it.id}`, {method:'DELETE'});
        if(!resp.ok) throw new Error('Delete failed');
        imagesData = await tryFetch('/api/images') || [];
        const filtered = filterImagesByTags(imagesData);
        renderGallery(filtered);
      }catch(e){ alert('Delete failed (server must support image deletion)'); }
    });
    actions.appendChild(openBtn); actions.appendChild(delBtn);
    card.appendChild(t); card.appendChild(meta); card.appendChild(actions);
    gallery.appendChild(card);
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}

function renderGallery(imgs){
  const filtered = filterImagesByTags(imgs || []);
  showDiagModal(filtered);
}
// Equations management
function openEquationEditor(equation){
  const editor = document.getElementById('equationEditor');
  const title = document.getElementById('eqEditorTitle');
  const nameField = document.getElementById('eqName');
  const contentField = document.getElementById('eqContent');
  const descField = document.getElementById('eqDescription');
  const tagsField = document.getElementById('eqTags');
  const idField = document.getElementById('eqId');
  
  editor.classList.remove('hidden');
  editor.setAttribute('aria-hidden','false');
  
  if(equation){
    title.textContent = 'Edit equation';
    nameField.value = equation.name || '';
    contentField.value = equation.content || '';
    descField.value = equation.description || '';
    tagsField && (tagsField.value = (equation.tags && equation.tags.length>0) ? equation.tags.join(', ') : '');
    idField.value = equation.id || '';
  }else{
    title.textContent = 'Add a new equation';
    nameField.value = '';
    contentField.value = '';
    descField.value = '';
    tagsField && (tagsField.value = '');
    idField.value = '';
  }
  nameField.focus();
}

function closeEquationEditor(){
  const editor = document.getElementById('equationEditor');
  editor.classList.add('hidden');
  editor.setAttribute('aria-hidden','true');
}

async function saveEquation(name, content, description, id, tags){
  try{
    if(id){
      const resp = await fetch(`/api/equations/${id}`, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, content, description, tags})
      });
      if(!resp.ok) throw new Error('Failed to update');
      return await resp.json();
    }else{
      const resp = await fetch('/api/equations', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, content, description, tags})
      });
      if(!resp.ok) throw new Error('Failed to create');
      return await resp.json();
    }
  }catch(e){
    alert('Could not save equation. Is the server running?');
    return null;
  }
}

async function deleteEquation(id){
  try{
    const resp = await fetch(`/api/equations/${id}`, {method:'DELETE'});
    if(!resp.ok) throw new Error('Delete failed');
    // Reload equations
    equationsData = await tryFetch('/api/equations') || [];
    renderEquationsList(equationsData);
  }catch(e){
    alert('Could not delete equation. Is the server running?');
  }
}

function equationMatchesTags(eq){
  if(selectedTags.size === 0) return true;
  const itemTags = new Set(eq.tags || []);
  for(const tag of selectedTags){ if(!itemTags.has(tag)) return false; }
  return true;
}

function renderEquationsList(equations){
  const container = document.getElementById('equationsList');
  const searchField = document.getElementById('eqSearch');
  container.innerHTML = '';
  
  let filtered = equations;
  
  function filterEquations(q){
    const s = (q||'').trim().toLowerCase();
    let base = equations.slice();
    if(s){
      base = base.filter(eq => 
      (eq.name || '').toLowerCase().includes(s) || 
      (eq.content || '').toLowerCase().includes(s) || 
      (eq.description || '').toLowerCase().includes(s)
      );
    }
    // tag filter (AND)
    base = base.filter(equationMatchesTags);
    return base;
  }
  
  function renderList(){
    container.innerHTML = '';
    if(filtered.length === 0){
      container.textContent = 'No equations found.';
      return;
    }
    for(const eq of filtered){
      const card = document.createElement('div');
      card.className = 'item';
      const h = document.createElement('h3');
      h.textContent = eq.name || '';
      const p = document.createElement('p');
      p.style.fontSize = '15px';
      p.style.padding = '8px 0';
      // Render LaTeX with KaTeX if available
      if(window.katex){
        try{
          katex.render(eq.content || '', p, {
            throwOnError: false,
            displayMode: true
          });
        }catch(e){
          // Fallback to plain text if LaTeX rendering fails
          p.style.fontFamily = 'monospace';
          p.style.whiteSpace = 'pre-wrap';
          p.textContent = eq.content || '';
        }
      }else{
        p.style.fontFamily = 'monospace';
        p.style.whiteSpace = 'pre-wrap';
        p.textContent = eq.content || '';
      }
      if(eq.description){
        const desc = document.createElement('p');
        desc.style.color = 'var(--muted)';
        desc.style.fontSize = '14px';
        desc.style.whiteSpace = 'pre-wrap';
        desc.textContent = eq.description;
        card.appendChild(h);
        card.appendChild(p);
        card.appendChild(desc);
      }else{
        card.appendChild(h);
        card.appendChild(p);
      }
      if(eq.tags && eq.tags.length>0){
        const tagsDiv = document.createElement('div');
        tagsDiv.style.marginBottom = '8px';
        tagsDiv.style.display = 'flex';
        tagsDiv.style.gap = '6px';
        tagsDiv.style.flexWrap = 'wrap';
        for(const tag of eq.tags){
          const tagEl = document.createElement('span');
          tagEl.style.backgroundColor = 'rgba(77,161,255,0.15)';
          tagEl.style.color = 'var(--accent)';
          tagEl.style.padding = '2px 8px';
          tagEl.style.borderRadius = '4px';
          tagEl.style.fontSize = '12px';
          tagEl.style.fontWeight = '500';
          tagEl.textContent = tag;
          tagsDiv.appendChild(tagEl);
        }
        card.appendChild(tagsDiv);
      }
      const actions = document.createElement('div');
      actions.className = 'itemActions';
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        openEquationEditor(eq);
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        if(confirm(`Delete equation "${eq.name}"?`)) deleteEquation(eq.id);
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      container.appendChild(card);
    }
  }
  
  // Wire search
  searchField.value = '';
  searchField.oninput = ()=>{
    filtered = filterEquations(searchField.value);
    renderList();
  };
  
  filtered = filterEquations(searchField.value);
  renderList();
}

// Wire equation editor buttons
document.addEventListener('DOMContentLoaded', ()=>{
  const eqShowAdd = document.getElementById('eqShowAdd');
  eqShowAdd && eqShowAdd.addEventListener('click', ()=>openEquationEditor());
  
  const eqCancelBtn = document.getElementById('eqCancelBtn');
  eqCancelBtn && eqCancelBtn.addEventListener('click', ()=>closeEquationEditor());
  
  const eqForm = document.getElementById('eqForm');
  eqForm && eqForm.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const name = document.getElementById('eqName').value.trim();
    const content = document.getElementById('eqContent').value.trim();
    const description = document.getElementById('eqDescription').value.trim();
    const tags = document.getElementById('eqTags').value.trim();
    const id = document.getElementById('eqId').value;
    
    if(!name || !content){ alert('Name and equation/formula are required'); return; }
    
    const result = await saveEquation(name, content, description, id, tags);
    if(result){
      closeEquationEditor();
      equationsData = await tryFetch('/api/equations') || [];
      renderEquationsList(equationsData);
    }
  });
}, {once: true});

// Helper: filter images by selected tags (AND semantics)
function filterImagesByTags(imgs){
  if(selectedTags.size === 0) return imgs.slice();
  return (imgs||[]).filter(it=>{
    const itemTags = new Set(it.tags || []);
    for(const tag of selectedTags){ if(!itemTags.has(tag)) return false; }
    return true;
  });
}