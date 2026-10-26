/* Producer-Consumer simulation: laboratory sample buffer (capacity 5).
   modes: safe | no_mutex | no_semaphore                                     */
const SAMPLE_TYPES = ['Blood', 'Urine', 'Tissue'];
const CAPACITY = 5;

class Run {
  constructor(cfg) {
    this.cfg = Object.assign({ mode: 'safe', producers: 1, consumers: 1, produceMs: 700, consumeMs: 1100, speed: 1 }, cfg);
    this.slots = Array(CAPACITY).fill(null);
    this.inI = 0; this.outI = 0; this.count = 0;
    this.empty = new Semaphore(CAPACITY);
    this.full = new Semaphore(0);
    this.mutex = this.cfg.mode === 'no_mutex' ? new NoMutex() : new Mutex();
    this.stats = { produced: 0, consumed: 0, fullWaits: 0, emptyWaits: 0, overflow: 0, underflow: 0, lost: 0, corrupt: 0 };
    this.log = []; this.logVersion = 0;
    this.workers = {}; this.history = [];
    this.nextId = 101; this.alive = false; this.paused = false;
    this.resumeWaiters = []; this.t0 = 0; this.pausedAt = 0; this.pausedTotal = 0;
    this.timer = null;
  }
  get speed() { return this.cfg.speed; }
  elapsed() { if (!this.t0) return 0; return ((this.paused ? this.pausedAt : Date.now()) - this.t0 - this.pausedTotal) / 1000; }
  say(who, msg, level = 'info') {
    this.log.push({ t: this.elapsed().toFixed(1), who, msg, level });
    if (this.log.length > 400) this.log.shift();
    this.logVersion++;
  }
  sleep(ms) { return new Promise(r => setTimeout(r, Math.max(1, ms / this.speed))); }
  jitter(ms) { return ms * (0.7 + Math.random() * 0.6); }
  async gate() { while (this.paused && this.alive) await new Promise(r => this.resumeWaiters.push(r)); }
  actual() { return this.slots.filter(Boolean).length; }

  start() {
    this.alive = true; this.t0 = Date.now();
    this.say('System', `Simulation started - mode: ${this.cfg.mode}`);
    for (let i = 1; i <= this.cfg.producers; i++) this.producer('Producer-' + i);
    for (let i = 1; i <= this.cfg.consumers; i++) this.consumer('Consumer-' + i);
    this.timer = setInterval(() => {
      if (this.paused) return;
      this.history.push(this.actual()); if (this.history.length > 160) this.history.shift();
    }, 250);
  }
  pause() { if (!this.alive || this.paused) return; this.paused = true; this.pausedAt = Date.now(); this.say('System', 'Paused'); }
  resume() {
    if (!this.paused) return;
    this.pausedTotal += Date.now() - this.pausedAt; this.paused = false;
    this.say('System', 'Resumed');
    this.resumeWaiters.splice(0).forEach(r => r());
  }
  stop() {
    this.alive = false; clearInterval(this.timer);
    this.paused = false; this.resumeWaiters.splice(0).forEach(r => r());
  }

  /* ---------------- PRODUCER : insert a sample ---------------- */
  async put(name, item) {
    const mode = this.cfg.mode, useSem = mode !== 'no_semaphore', racy = mode === 'no_mutex';
    if (useSem) {
      if (this.empty.n === 0) {                       // CONDITION 1 : buffer full
        this.workers[name] = 'waiting'; this.stats.fullWaits++;
        this.say(name, `Buffer FULL - ${item.id} waits for an empty slot`, 'warn');
      }
      await this.empty.acquire(); if (!this.alive) return false;
    }
    await this.mutex.acquire(name); if (!this.alive) return false;
    this.workers[name] = 'inserting ' + item.id;
    if (!useSem && this.count >= CAPACITY) {          // overflow demo (no semaphore)
      this.stats.overflow++; this.say(name, `BUFFER OVERFLOW - ${item.id} discarded`, 'danger');
      this.mutex.release(); return false;
    }
    const slot = this.inI, c = this.count;            // ---- critical section ----
    if (this.slots[slot]) {                           // CONDITION 3 : race condition
      this.stats.lost++;
      this.say(name, `RACE CONDITION - ${item.id} overwrote ${this.slots[slot].id} in slot ${slot + 1}`, 'danger');
    }
    this.slots[slot] = item;
    await this.sleep(racy ? 40 : 110);                // time spent inside critical section
    this.inI = (slot + 1) % CAPACITY;
    this.count = c + 1;                               // read-modify-write on shared counter
    this.mutex.release();                             // ---- end critical section ----
    this.stats.produced++;
    this.say(name, `Inserted ${item.id} (${item.type}) into slot ${slot + 1}`, 'ok');
    if (useSem) this.full.release();
    return true;
  }

  /* ---------------- CONSUMER : take a sample ---------------- */
  async get(name) {
    const mode = this.cfg.mode, useSem = mode !== 'no_semaphore', racy = mode === 'no_mutex';
    if (useSem) {
      if (this.full.n === 0) {                        // CONDITION 2 : buffer empty
        this.workers[name] = 'waiting'; this.stats.emptyWaits++;
        this.say(name, 'Buffer EMPTY - waiting for a sample', 'warn');
      }
      await this.full.acquire(); if (!this.alive) return null;
    }
    await this.mutex.acquire(name); if (!this.alive) return null;
    if (!useSem && this.count <= 0) {                 // underflow demo (no semaphore)
      this.stats.underflow++; this.say(name, 'BUFFER UNDERFLOW - nothing to take', 'danger');
      this.mutex.release(); return null;
    }
    const slot = this.outI, c = this.count, item = this.slots[slot];   // ---- critical section ----
    this.slots[slot] = null;
    await this.sleep(racy ? 40 : 110);
    this.outI = (slot + 1) % CAPACITY;
    this.count = c - 1;
    this.mutex.release();                             // ---- end critical section ----
    if (useSem) this.empty.release();
    if (!item) {
      this.stats.corrupt++;
      this.say(name, `RACE CONDITION - read empty slot ${slot + 1}`, 'danger'); return null;
    }
    this.stats.consumed++;
    this.say(name, `Took ${item.id} (${item.type}) from slot ${slot + 1}`, 'ok');
    return item;
  }

  async producer(name) {
    while (this.alive) {
      await this.gate(); this.workers[name] = 'collecting sample';
      await this.sleep(this.jitter(this.cfg.produceMs)); if (!this.alive) break;
      await this.gate();
      const item = { id: 'S' + this.nextId++, type: SAMPLE_TYPES[Math.floor(Math.random() * 3)] };
      await this.put(name, item);
    }
    this.workers[name] = 'stopped';
  }
  async consumer(name) {
    while (this.alive) {
      await this.gate(); if (this.workers[name] !== 'waiting') this.workers[name] = 'idle';
      const item = await this.get(name);
      if (!this.alive) break;
      if (!item) { await this.sleep(200); continue; }
      this.workers[name] = 'processing ' + item.id;
      await this.sleep(this.jitter(this.cfg.consumeMs));
    }
    this.workers[name] = 'stopped';
  }
}

if (typeof module !== 'undefined') {
  const s = require('./sync.js'); Object.assign(global, s);
  module.exports = { Run, CAPACITY };
}
