// Run with:  node tests/test.js
const { Run } = require('../js/simulator.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

async function go(cfg, ms = 3500) { const r = new Run(Object.assign({ speed: 4 }, cfg)); r.start(); await wait(ms); r.stop(); await wait(100); return r; }

(async () => {
  let r = await go({ mode: 'safe', producers: 3, consumers: 1, produceMs: 100, consumeMs: 600 });
  const s = r.stats;
  ok(s.lost + s.corrupt + s.overflow + s.underflow === 0, 'safe: no errors');
  ok(r.count === r.actual(), 'safe: counter matches buffer');
  ok(r.actual() <= 5, 'safe: never exceeds capacity');
  ok(s.fullWaits > 0, 'safe: producer waited when buffer full (Condition 1)');

  r = await go({ mode: 'safe', producers: 1, consumers: 3, produceMs: 900, consumeMs: 100 });
  ok(r.stats.emptyWaits > 0, 'safe: consumer waited when buffer empty (Condition 2)');
  ok(r.stats.lost + r.stats.corrupt === 0, 'safe: no corruption');

  r = await go({ mode: 'no_mutex', producers: 3, consumers: 3, produceMs: 100, consumeMs: 100 });
  ok(r.stats.lost + r.stats.corrupt > 0 || r.count !== r.actual(), 'no_mutex: race condition appears (Condition 3)');

  r = await go({ mode: 'no_semaphore', producers: 3, consumers: 1, produceMs: 100, consumeMs: 800 });
  ok(r.stats.overflow > 0, 'no_semaphore: overflow occurs');

  r = await go({ mode: 'no_semaphore', producers: 1, consumers: 3, produceMs: 900, consumeMs: 100 });
  ok(r.stats.underflow > 0, 'no_semaphore: underflow occurs');

  console.log(fail ? `\n${fail} FAILED` : '\nALL TESTS PASSED'); process.exit(fail ? 1 : 0);
})();
