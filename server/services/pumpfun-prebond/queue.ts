export type PrebondQueueJob = {
  signature: string;
  slot: number;
  logs: string[];
  seenAtMs: number;
};

export class PrebondQueue {
  private readonly queue: PrebondQueueJob[] = [];
  private readonly maxDepth: number;
  private processing = false;

  constructor(
    private readonly worker: (job: PrebondQueueJob) => Promise<void>,
    maxDepth = 2000,
  ) {
    this.maxDepth = Math.max(100, maxDepth);
  }

  enqueue(job: PrebondQueueJob) {
    if (this.queue.length >= this.maxDepth) {
      this.queue.shift();
    }
    this.queue.push(job);
    this.drain();
  }

  private drain() {
    if (this.processing) return;
    this.processing = true;

    void (async () => {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) continue;
        try {
          await this.worker(next);
        } catch {
          // Keep worker failures isolated so queue processing continues.
        }
      }
      this.processing = false;
    })();
  }
}
