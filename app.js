/* Dashboard controller: wires UI <-> Run engine */
const $ = id => document.getElementById(id);
let run = null, lastLog = -1, prevSlots = Array(5).fill(null);

const PRESETS = {
  full:     { mode: 'safe', producers: 3, consumers: 1, produceMs: 250, consumeMs: 1800 },
  empty:    { mode: 'safe', producers: 1, consumers: 3, produceMs: 1800, consumeMs: 300 },
  race:     { mode: 'no_mutex', producers: 3, consumers: 3, produceMs: 150, consumeMs: 150 },
  overflow: { mode: 'no_semaphore', producers: 3, consumers: 1, produceMs: 200, consumeMs: 1200 },
  balanced: { mode: 'safe', producers: 2, consumers: 2, produceMs: 900, consumeMs: 1100 },
};
const bind = [['np', 'npv'], ['nc', 'ncv'], ['pm', 'pmv'], ['cm', 'cmv'], ['sp', 'spv']];
bind.forEach(([i, v]) => $(i).addEventListener('input', () => { $(v).textContent = $(i).value; if (i === 'sp' && run) run.cfg.speed = +$('sp').value; }));

function readCfg() {
  return { mode: $('mode').value, producers: +$('np').value, consumers: +$('nc').value,
           produceMs: +$('pm').value, consumeMs: +$('cm').value, speed: +$('sp').value };
}
function applyCfg(c) {
  $('mode').value = c.mode; $('np').value = c.producers; $('nc').value = c.consumers;
  $('pm').value = c.produceMs; $('cm').value = c.consumeMs;
  bind.forEach(([i, v]) => $(v).textContent = $(i).value);
}
function startRun(cfg) {
  if (run) run.stop();
  run = new Run(cfg); lastLog = -1; prevSlots = Array(5).fill(null);
  $('log').innerHTML = ''; run.start(); $('bPause').textContent = '⏸ Pause';
}
$('bStart').onclick = () => startRun(readCfg());
$('bPause').onclick = () => {
  if (!run || !run.alive) return;
  if (run.paused) { run.resume(); $('bPause').textContent = '⏸ Pause'; } else { run.pause(); $('bPause').textContent = '▶ Resume'; }
};
$('bReset').onclick = () => { if (run) run.stop(); run = null; lastLog = -1; $('log').innerHTML = ''; render(); $('bPause').textContent = '⏸ Pause'; };
$('bClear').onclick = () => { $('log').innerHTML = ''; lastLog = run ? run.logVersion : -1; };
document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
  const p = Object.assign({ speed: +$('sp').value }, PRESETS[b.dataset.p]); applyCfg(p); startRun(p);
});

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function workerHtml(names, run) {
  return names.map(n => {
    const s = run.workers[n] || 'idle';
    const cls = s === 'waiting' ? 'waiting' : /^(processing|inserting)/.test(s) ? 'busy' : '';
    return `<div class="w ${cls}"><b>${n}</b><span>${s === 'waiting' ? '⏳ waiting' : esc(s)}</span></div>`;
  }).join('');
}
function mini(slots, id, empty) {
  $(id).innerHTML = slots.map((x, i) => empty ? `<div class="e">Empty</div>` : `<div class="f">${x ? x.id : 'S10' + (i + 1)}</div>`).join('');
}

function render() {
  const r = run, cap = CAPACITY;
  const slots = r ? r.slots : Array(cap).fill(null);
  const used = slots.filter(Boolean).length;
  const st = r ? r.stats : { produced: 0, consumed: 0, fullWaits: 0, emptyWaits: 0, overflow: 0, underflow: 0, lost: 0, corrupt: 0 };

  $('state').textContent = !r ? 'STOPPED' : r.paused ? 'PAUSED' : r.alive ? 'RUNNING' : 'STOPPED';
  $('state').className = 'pill ' + (!r ? '' : r.paused ? 'pause' : r.alive ? 'run' : '');
  $('time').textContent = (r ? r.elapsed() : 0).toFixed(1) + 's';

  // main buffer
  $('slots').innerHTML = slots.map((x, i) => {
    const cls = ['slot', x ? 'f' : '', r && i === r.inI ? 'in' : '', r && i === r.outI ? 'out' : '',
                 x && !prevSlots[i] ? 'pop' : ''].join(' ');
    return `<div class="${cls}">${x ? x.id + '<small>' + x.type + '</small>' : 'Empty'}</div>`;
  }).join('');
  prevSlots = slots.slice();
  $('used').textContent = used + '/' + cap;
  $('meterFill').style.width = (used / cap * 100) + '%';
  $('meterFill').style.background = used === cap ? '#ef4444' : used === 0 ? '#f59e0b' : '#22c55e';
  $('bufBox').className = 'node buffer' + (r && r.alive && used === cap ? ' isfull' : r && r.alive && used === 0 ? ' isempty' : '');
  const drift = r ? r.count - used : 0;
  $('counterLine').innerHTML = `shared counter = <b>${r ? r.count : 0}</b>` + (drift ? ` <b style="color:#f87171">≠ real ${used} (drift ${drift})</b>` : '');

  // workers
  const pn = r ? Array.from({ length: r.cfg.producers }, (_, i) => 'Producer-' + (i + 1)) : [];
  const cn = r ? Array.from({ length: r.cfg.consumers }, (_, i) => 'Consumer-' + (i + 1)) : [];
  $('prod').innerHTML = r ? workerHtml(pn, r) : ''; $('cons').innerHTML = r ? workerHtml(cn, r) : '';
  $('arrIn').classList.toggle('flow-on', !!r && pn.some(n => /inserting/.test(r.workers[n] || '')));
  $('arrOut').classList.toggle('flow-on', !!r && cn.some(n => /processing/.test(r.workers[n] || '')));

  // Condition 1 - full
  const pw = r && pn.some(n => r.workers[n] === 'waiting') && used === cap;
  mini(slots.map((_, i) => slots[i]), 'm1', false);
  $('s1').textContent = pw ? 'Producer waits for an empty slot.' : used === cap ? 'Buffer full - next producer will wait.' : 'Producer is not blocked.';
  $('s1').className = 'status' + (pw || used === cap ? ' bad' : '');
  $('c1').className = 'card cond' + (pw ? ' hot' : '');
  $('n1').textContent = st.fullWaits; $('o1').textContent = st.overflow;

  // Condition 2 - empty
  const cw = r && cn.some(n => r.workers[n] === 'waiting') && used === 0;
  $('m2').innerHTML = Array(cap).fill('<div class="e">Empty</div>').join('');
  if (used > 0) $('m2').innerHTML = slots.map(x => x ? `<div class="f" style="background:#dcfce7;color:#065f46">${x.id}</div>` : '<div class="e">Empty</div>').join('');
  $('s2').textContent = cw ? 'Consumer waits for a sample.' : used === 0 ? 'Buffer empty - next consumer will wait.' : 'Consumer is not blocked.';
  $('s2').className = 'status' + (cw || used === 0 ? ' amber' : '');
  $('c2').className = 'card cond' + (cw ? ' hot amber' : '');
  $('n2').textContent = st.emptyWaits; $('o2').textContent = st.underflow;

  // Condition 3 - race / mutex
  const m = r && r.mutex, noMutex = r && r.cfg.mode === 'no_mutex';
  $('lock').className = 'lock' + (noMutex ? ' none' : m && m.locked ? ' held' : '');
  $('lock').textContent = noMutex ? '🚫 No mutex (unsafe)' : m && m.locked ? '🔒 Held by ' + m.owner : '🔓 Free';
  const bad = st.lost + st.corrupt > 0 || drift !== 0;
  $('s3').textContent = bad ? 'RACE CONDITION detected - shared data corrupted!' : 'Counter and buffer agree ✓';
  $('s3').className = 'status' + (bad ? ' bad' : '');
  $('c3').className = 'card cond' + (bad ? ' hot' : '');
  $('n3').textContent = m ? m.contention : 0; $('l3').textContent = st.lost; $('k3').textContent = st.corrupt;

  // totals
  const S = (l, v, c = '') => `<div class="stat ${v && c ? c : ''}"><div>${v}</div><span>${l}</span></div>`;
  $('stats').innerHTML = S('Produced', st.produced) + S('Processed', st.consumed) + S('In buffer', used) +
    S('Producer waits', st.fullWaits) + S('Consumer waits', st.emptyWaits) +
    S('Overflow', st.overflow, 'bad') + S('Underflow', st.underflow, 'bad') + S('Lost (race)', st.lost, 'bad') + S('Corrupt', st.corrupt, 'bad');

  // log
  if (r && r.logVersion !== lastLog) {
    const L = $('log'), bottom = L.scrollTop + L.clientHeight >= L.scrollHeight - 24;
    L.innerHTML = r.log.slice(-120).map(e => `<div class="${e.level}">[${e.t}s] ${e.who}: ${esc(e.msg)}</div>`).join('');
    if (bottom) L.scrollTop = L.scrollHeight; lastLog = r.logVersion;
  }
  drawChart();
}

function drawChart() {
  const c = $('chart'), g = c.getContext('2d'), W = c.width, H = c.height, h = run ? run.history : [];
  g.clearRect(0, 0, W, H); g.strokeStyle = '#2a2a2a'; g.fillStyle = '#777'; g.font = '11px sans-serif';
  for (let i = 0; i <= 5; i++) { const y = H - 18 - i * (H - 30) / 5; g.beginPath(); g.moveTo(26, y); g.lineTo(W, y); g.stroke(); g.fillText(i, 8, y + 4); }
  g.strokeStyle = '#ef444477'; g.setLineDash([4, 4]); const yF = H - 18 - (H - 30); g.beginPath(); g.moveTo(26, yF); g.lineTo(W, yF); g.stroke(); g.setLineDash([]);
  if (h.length < 2) return;
  g.strokeStyle = '#22c55e'; g.lineWidth = 2; g.beginPath();
  h.forEach((v, i) => { const x = 26 + i * (W - 30) / 159, y = H - 18 - v * (H - 30) / 5; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1;
}

setInterval(render, 100); render();
