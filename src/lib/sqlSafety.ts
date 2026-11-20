import type { Database } from 'sql.js';

const FORBIDDEN = /\b(?:attach|detach|pragma|create|alter|drop|insert|update|delete|replace|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|transaction|load_extension|readfile|writefile)\b/i;

/** Strip quoted strings and comments for policy checks without changing the submitted SQL. */
function maskLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\r\n]*/g, match => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/'(?:''|[^'])*'/g, match => ' '.repeat(match.length))
    .replace(/"(?:""|[^"])*"/g, match => ' '.repeat(match.length))
    .replace(/`(?:``|[^`])*`/g, match => ' '.repeat(match.length));
}

export function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error('Write a SQL query before running it.');
  if (trimmed.length > 20_000) throw new Error('Query is longer than the 20,000 character limit.');
  const masked = maskLiteralsAndComments(trimmed).trim();
  if (!/^(?:select|with)\b/i.test(masked)) throw new Error('Only read-only SELECT queries are allowed.');
  if (FORBIDDEN.test(masked)) throw new Error('This query uses an operation that is not allowed in the read-only workspace.');
  const semicolons = [...masked.matchAll(/;/g)];
  if (semicolons.length > 1 || (semicolons.length === 1 && masked.slice(semicolons[0].index! + 1).trim())) {
    throw new Error('Run one SQL statement at a time.');
  }
  if (/\b(?:sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema)\b/i.test(masked)) {
    throw new Error('SQLite internal schema tables are not available in this workspace.');
  }
  return trimmed.replace(/;\s*$/, '');
}

export interface BoundedSqlResult { columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean; }

export function executeBoundedReadOnlyQuery(database: Database, sql: string): BoundedSqlResult {
  const safeQuery = validateReadOnlySql(sql);
  database.run('PRAGMA query_only=ON;');
  const result = database.exec(`SELECT * FROM (${safeQuery}) AS proofpilot_bounded_result LIMIT 201`)[0];
  if (!result) throw new Error('The query did not return a result set.');
  if (result.columns.length > 30) throw new Error('The query returned more than 30 columns.');
  const truncated = result.values.length > 200;
  const rows = result.values.slice(0, 200).map(row => row.map(value => {
    if (value instanceof Uint8Array) return `[binary data: ${value.byteLength} bytes]`;
    const text = String(value ?? '');
    return text.length > 500 ? `${text.slice(0, 500)}…` : value;
  }));
  const payload: BoundedSqlResult = { columns: result.columns, rows, rowCount: rows.length, truncated };
  if (JSON.stringify(payload).length > 50_000) throw new Error('Query output exceeded the 50 KB result limit. Add filters or return fewer columns.');
  return payload;
}
