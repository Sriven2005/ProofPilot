import type { GuidedQueryEvidence } from '../types';

interface WorkerResponse {
  id: number;
  ok: boolean;
  rowCount?: number;
  columns?: string[];
  rows?: unknown[][];
  truncated?: boolean;
  error?: string;
}
interface Pending { resolve(value: WorkerResponse): void; reject(reason: Error): void; timer: number; }

export class RetailSqlSession {
  private readonly worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;
  readonly ready: Promise<number>;

  constructor() {
    this.worker = new Worker(new URL('./retailSql.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', this.onMessage);
    this.ready = this.request({ kind: 'init' }, 20_000).then(result => {
      if (!result.ok) throw new Error(result.error ?? 'Could not load the retail dataset.');
      return result.rowCount ?? 0;
    });
    this.ready.catch(() => this.close());
  }

  private onMessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = this.pending.get(event.data.id);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    this.pending.delete(event.data.id);
    pending.resolve(event.data);
  };

  private request(payload: { kind: 'init' | 'query'; sql?: string }, timeout: number): Promise<WorkerResponse> {
    if (this.closed) return Promise.reject(new Error('SQL worker is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.worker.terminate();
        this.closed = true;
        this.pending.delete(id);
        reject(new Error(payload.kind === 'query' ? 'Query exceeded the 5 second time limit.' : 'SQLite WebAssembly took too long to initialize.'));
        for (const item of this.pending.values()) { window.clearTimeout(item.timer); item.reject(new Error('SQL worker stopped after a timeout.')); }
        this.pending.clear();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, ...payload });
    });
  }

  async run(sql: string): Promise<GuidedQueryEvidence> {
    await this.ready;
    const result = await this.request({ kind: 'query', sql }, 5_000);
    const base = { sql, columns: result.columns ?? [], rows: result.rows ?? [], rowCount: result.rowCount ?? 0, ...(result.truncated ? { truncated: true } : {}), runAt: new Date().toISOString() };
    if (!result.ok) return { ...base, status: 'error', error: result.error ?? 'SQL execution failed.' };
    return { ...base, status: 'success' };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const item of this.pending.values()) { window.clearTimeout(item.timer); item.reject(new Error('SQL session closed.')); }
    this.pending.clear();
  }
}
