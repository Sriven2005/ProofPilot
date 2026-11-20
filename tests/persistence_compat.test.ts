import assert from 'node:assert/strict';
import { appendAssessmentRecordPreservingUnknown, inspectAssessmentStorage } from '../src/lib/persistence.ts';
import type { AssessmentRecord } from '../src/types.ts';

const record: AssessmentRecord = {
  id: 'PP-2026-ABC123', candidate: 'Candidate', challengeId: 'analyst-retention', answer: 'A response with evidence',
  evaluation: { score: 50, criteria: [], strengths: [], improvements: [], summary: '', completedAt: '2026-01-01T00:00:00Z' }
};
const unsupported = { id: 'legacy-unknown', role: 'New role', oldShape: true };
const original = JSON.stringify([unsupported]);
const snapshot = inspectAssessmentStorage(original);
assert.equal(snapshot.unsupportedCount, 1);
const appended = JSON.parse(appendAssessmentRecordPreservingUnknown(original, record)) as unknown[];
assert.deepEqual(appended[0], unsupported, 'Opaque legacy data remains intact when new data is appended.');
assert.equal((appended[1] as { id: string }).id, record.id);
assert.equal(inspectAssessmentStorage('{bad-json').unsupportedCount, 1);
assert.throws(() => appendAssessmentRecordPreservingUnknown('{bad-json', record), /left unchanged/);
assert.equal(appendAssessmentRecordPreservingUnknown(original, record), appendAssessmentRecordPreservingUnknown(original, record), 'Append is deterministic for the same input.');
console.log('Local assessment compatibility tests passed (6 assertions).');
