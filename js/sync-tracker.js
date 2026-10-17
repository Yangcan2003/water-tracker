// Track failures by request, so only recovery of that request clears its error.
export const SYNC_TIMEOUT_MS = 12_000;

export class SyncTracker {
  constructor(onChange = () => {}, { timeoutMs = SYNC_TIMEOUT_MS } = {}) {
    this.onChange = onChange;
    this.timeoutMs = timeoutMs;
    this.reset();
  }

  reset() {
    this.generation = (this.generation || 0) + 1;
    this.pending = 0;
    this.failures = new Map();
    this.versions = new Map();
    this.lastSyncedAt = null;
    this.retryPromise = null;
  }

  async run(request) {
    const generation = this.generation;
    const version = (this.versions.get(request.key) || 0) + 1;
    this.versions.set(request.key, version);
    this.pending++;
    this.onChange();
    const controller = new AbortController();
    let timer, expired = false, acknowledged = false;
    const isCurrent = () => generation === this.generation && version === this.versions.get(request.key);
    try {
      const operation = Promise.resolve(request.operation({ signal: controller.signal }));
      const observed = operation.then(result => {
        acknowledged = true;
        // Firebase writes cannot be cancelled once submitted. A late server ACK
        // can recover this exact write, but cannot clear a newer edit's failure.
        if (expired && request.kind === "write" && request.recoverOnLateSuccess !== false && isCurrent()) {
          this.failures.delete(request.key);
          if (!this.pending && !this.failures.size) this.lastSyncedAt = new Date();
          this.onChange();
        }
        return result;
      }, error => {
        if (expired && isCurrent()) {
          this.failures.set(request.key, { request, error });
          this.onChange();
        }
        throw error;
      });
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          const error = Object.assign(new Error("云端连接超时，请稍后重试"), { code: "deadline-exceeded" });
          controller.abort(error);
          reject(error);
        }, request.timeoutMs ?? this.timeoutMs);
      });
      const result = await Promise.race([observed, deadline]);
      if (isCurrent()) {
        this.failures.delete(request.key);
      }
      return result;
    } catch (error) {
      if (isCurrent() && !(expired && acknowledged && request.kind === "write" && request.recoverOnLateSuccess !== false)) {
        this.failures.set(request.key, { request, error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) {
        this.pending--;
        if (!this.pending && !this.failures.size) this.lastSyncedAt = new Date();
        this.onChange();
      }
    }
  }

  retry() {
    if (this.retryPromise) return this.retryPromise;
    const generation = this.generation;
    const failures = [...this.failures.values()];
    const retry = (async () => {
      await Promise.allSettled(failures.filter(failure => failure.request.retry !== false).map(async failure => {
        if (generation !== this.generation) return;
        if (this.failures.get(failure.request.key) !== failure) return;
        try { await this.run(failure.request); } catch { /* Keep the specific failure. */ }
      }));
    })();
    this.retryPromise = retry;
    return retry.finally(() => {
      if (generation === this.generation) this.retryPromise = null;
    });
  }
}
