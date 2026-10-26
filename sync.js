/* Real synchronization primitives (promise based) used by the simulator. */
class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async acquire() {            // resolves true if the caller had to wait
    if (this.n > 0) { this.n--; return false; }
    await new Promise(r => this.q.push(r));
    return true;
  }
  release() { if (this.q.length) this.q.shift()(); else this.n++; }
  get waiting() { return this.q.length; }
}

class Mutex {
  constructor() { this.locked = false; this.owner = null; this.q = []; this.contention = 0; }
  async acquire(who) {
    if (!this.locked) { this.locked = true; this.owner = who; return; }
    this.contention++;         // another thread wanted the lock -> collision prevented
    await new Promise(r => this.q.push([r, who]));
  }
  release() {
    if (this.q.length) { const [r, w] = this.q.shift(); this.owner = w; r(); }
    else { this.locked = false; this.owner = null; }
  }
}

class NoMutex {                // used in "race condition" demo: no protection at all
  constructor() { this.locked = false; this.owner = null; this.contention = 0; }
  async acquire() {}
  release() {}
}

if (typeof module !== 'undefined') module.exports = { Semaphore, Mutex, NoMutex };
