/** Embedded as-is by report-view. No runtime libraries or network requests. */
export function reportApp(config) {
  const $ = id => document.getElementById(id);
  const sections = [...document.querySelectorAll('[data-run-section]')];
  const status = $('status-filter');
  const search = $('test-search');
  const runSelect = $('run-select');
  let runId = config.selectedRunId;
  let lastFocus = null;
  let imageSet = [];
  let imageIndex = 0;
  let activeEvidence = null;
  const dialog = $('lightbox');

  function applyTheme(theme) {
    document.body.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    $('themeBtn').textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
  }
  try { applyTheme(localStorage.getItem('wq-theme')); } catch { applyTheme('light'); }
  $('themeBtn').addEventListener('click', () => {
    const theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('wq-theme', theme); } catch { /* optional persistence */ }
  });

  function filter() {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    let shown = 0;
    for (const section of sections) {
      const active = section.dataset.runSection === runId;
      section.hidden = !active;
      if (!active) continue;
      for (const flow of section.querySelectorAll('details.flow')) {
        let visible = 0;
        for (const test of flow.querySelectorAll('details.test')) {
          const matchesStatus = status.value === 'all' || (status.value === 'images'
            ? Number(test.dataset.screenshots) > 0 : test.dataset.status === status.value);
          const matchesQuery = !query || test.dataset.search.toLocaleLowerCase('pt-BR').includes(query);
          test.hidden = !(matchesStatus && matchesQuery);
          if (!test.hidden) { visible++; shown++; }
        }
        flow.hidden = visible === 0;
        if (query || status.value !== 'all') flow.open = visible > 0;
        flow.querySelector('.filter-count').textContent = `${visible} de ${flow.dataset.tests} testes`;
      }
      section.querySelector('.empty-search').hidden = shown > 0;
    }
    for (const link of document.querySelectorAll('[data-flow-link]')) {
      link.hidden = link.dataset.runId !== runId;
    }
    $('filter-counter').textContent = `${shown} testes encontrados na execução selecionada`;
    const info = config.runs.find(run => run.id === runId);
    if (info) {
      $('run-status').textContent = info.displayStatus;
      $('run-status').className = 'badge ' + info.stamp.toLowerCase();
      $('flow-count').textContent = info.flows;
      $('test-count').textContent = info.tests;
      $('pass-count').textContent = info.counts.pass;
      $('attention-count').textContent = info.counts.fail + info.counts.blocked + info.counts.warn + info.counts.skip;
      $('run-breakdown').textContent = `${info.counts.pass} PASS · ${info.counts.fail} FAIL · ${info.counts.blocked} BLOCKED · ${info.counts.warn} WARN · ${info.counts.skip} SKIP`;
      $('evidence-coverage').textContent = `${info.screenshots} capturas em ${info.testsWithImages} de ${info.tests} testes. Registros JSON são mostrados separadamente.`;
    }
  }
  function selectRun(id) {
    if (!config.runs.some(run => run.id === id)) return;
    runId = id;
    runSelect.value = id;
    search.value = '';
    status.value = 'all';
    for (const section of sections) for (const detail of section.querySelectorAll('details')) detail.open = false;
    filter();
  }
  runSelect.addEventListener('change', () => {
    if (dialog.open) dialog.close();
    selectRun(runSelect.value);
    history.replaceState(null, '', '#flows');
  });
  search.addEventListener('input', filter);
  status.addEventListener('change', filter);
  $('clear-filters').addEventListener('click', () => { search.value = ''; status.value = 'all'; filter(); });

  function reveal(element) {
    const section = element.closest('[data-run-section]');
    if (section && section.dataset.runSection !== runId) selectRun(section.dataset.runSection);
    if (element.closest('[hidden]')) { search.value = ''; status.value = 'all'; filter(); }
    let parent = element;
    while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function followHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const element = $(id) || (['tests', 'evidence'].includes(id) ? $('flows') : null);
    if (!element) return;
    reveal(element);
    const control = element.matches('details') ? element.querySelector('summary') : element;
    if (control?.matches('summary,button,a')) control.focus({ preventScroll: true });
  }
  addEventListener('hashchange', followHash);
  // Link hashes open their containing flow/test even when those details are collapsed.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash === location.hash) setTimeout(followHash, 0);
  });

  function showEvidence(element) {
    activeEvidence = element;
    const test = element.closest('details.test');
    imageSet = test ? [...test.querySelectorAll('[data-evidence-kind="screenshot"]')]
      : [element]; // A historical reference never navigates into current-test evidence.
    imageIndex = Math.max(0, imageSet.indexOf(element));
    const image = element.querySelector('img');
    $('lbImg').src = image.src;
    $('lbImg').alt = image.alt;
    $('lbCap').textContent = element.dataset.caption;
    $('lbOrigin').textContent = element.dataset.origin;
    $('lbPosition').textContent = `${imageIndex + 1} / ${imageSet.length} · ${test ? 'Evidências deste teste' : 'Referência histórica — fora da execução selecionada'}`;
    $('lbPrev').disabled = imageSet.length < 2;
    $('lbNext').disabled = imageSet.length < 2;
    if (!dialog.open) { lastFocus = document.activeElement; dialog.showModal(); }
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-open-evidence]');
    if (trigger) showEvidence($(trigger.dataset.openEvidence));
    const download = event.target.closest('[data-download-evidence]');
    if (download) downloadEvidence($(download.dataset.downloadEvidence));
  });
  function moveImage(delta) {
    if (imageSet.length < 2) return;
    showEvidence(imageSet[(imageIndex + delta + imageSet.length) % imageSet.length]);
  }
  $('lbPrev').addEventListener('click', () => moveImage(-1));
  $('lbNext').addEventListener('click', () => moveImage(1));
  $('lbClose').addEventListener('click', () => dialog.close());
  $('lbDownload').addEventListener('click', () => { if (activeEvidence) downloadEvidence(activeEvidence); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveImage(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveImage(1); }
  });
  dialog.addEventListener('close', () => { lastFocus?.focus({ preventScroll: true }); });
  function downloadEvidence(element) {
    let bytes;
    let type;
    if (element.dataset.evidenceKind === 'screenshot') {
      const base64 = element.querySelector('img').src.split(',')[1];
      bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      type = 'image/png';
    } else {
      bytes = Uint8Array.from(atob(element.dataset.contentBase64), char => char.charCodeAt(0));
      type = element.dataset.evidenceKind === 'json' ? 'application/json' : 'text/plain';
    }
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = element.dataset.filename || 'evidencia';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.body.classList.add('ready');
  selectRun(runId);
  followHash();
  window.__reportReady = true;
}
