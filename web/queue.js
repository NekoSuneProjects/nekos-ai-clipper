// web/queue.js
//
// Dead-simple in-memory job queue that runs ONE job at a time (the user asked
// for serial processing). Emits "update" whenever a job changes so the server
// can push SSE progress. Jobs are kept in memory (lost on restart) — fine for v1.

const { EventEmitter } = require("events");

let counter = 0;

class JobQueue extends EventEmitter {
  constructor(worker) {
    super();
    this.worker = worker;       // async (job, onProgress) => void
    this.jobs = new Map();
    this.order = [];
    this.running = false;
  }

  add(data) {
    counter += 1;
    const id = Date.now().toString(36) + "-" + counter;
    const job = {
      id,
      status: "queued",
      progress: 0,
      step: "queued",
      createdAt: Date.now(),
      outputs: [],
      highlights: [],
      ...data,
    };
    this.jobs.set(id, job);
    this.order.push(id);
    this.emit("update", job);
    this._tick();
    return job;
  }

  get(id) { return this.jobs.get(id); }
  list() { return this.order.map((id) => this.jobs.get(id)); }

  position(id) {
    const queued = this.list().filter((j) => j.status === "queued").map((j) => j.id);
    const idx = queued.indexOf(id);
    return idx === -1 ? 0 : idx + 1;
  }

  async _tick() {
    if (this.running) return;
    const next = this.list().find((j) => j.status === "queued");
    if (!next) return;

    this.running = true;
    next.status = "running";
    next.startedAt = Date.now();
    this.emit("update", next);

    try {
      await this.worker(next, (p) => {
        if (p && typeof p === "object") {
          if (p.step) next.step = p.step;
          if (typeof p.progress === "number") next.progress = p.progress;
        } else if (typeof p === "number") {
          next.progress = p;
        }
        this.emit("update", next);
      });
      next.status = "done";
      next.progress = 100;
      next.finishedAt = Date.now();
    } catch (err) {
      next.status = "error";
      next.error = String((err && err.message) || err);
    }
    this.emit("update", next);

    this.running = false;
    setImmediate(() => this._tick());
  }
}

module.exports = { JobQueue };
