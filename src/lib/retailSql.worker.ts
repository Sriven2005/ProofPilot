import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { retailSalesRows, RETAIL_DATASET_SCHEMA } from '../data/retailSales';
import { executeBoundedReadOnlyQuery } from './sqlSafety';

interface WorkerRequest { id: number; kind: 'init' | 'query'; sql?: string; }
let database: import('sql.js').Database | null = null;
let initialized = false;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, kind, sql = '' } = event.data;
  try {
    if (kind === 'init') {
      if (!initialized) {
        const SQL = await initSqlJs({ locateFile: () => wasmUrl });
        database = new SQL.Database();
        database.run('PRAGMA foreign_keys=ON;');
        database.run(RETAIL_DATASET_SCHEMA);
        const insert = database.prepare('INSERT INTO retail_sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        try {
          for (const row of retailSalesRows) insert.run([row.order_id, row.order_date, row.product_id, row.product_name, row.category, row.region, row.quantity, row.unit_price, row.discount, row.revenue]);
        } finally { insert.free(); }
        database.run('PRAGMA query_only=ON;');
        initialized = true;
      }
      self.postMessage({ id, ok: true, rowCount: retailSalesRows.length });
      return;
    }
    if (!database || !initialized) throw new Error('The retail dataset is still loading. Try again in a moment.');
    const result = executeBoundedReadOnlyQuery(database, sql);
    self.postMessage({ id, ok: true, ...result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'SQL execution failed.' });
  }
};
