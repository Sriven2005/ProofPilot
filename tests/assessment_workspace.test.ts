import assert from 'node:assert/strict';
import { formatRemainingTime, GUIDED_ASSESSMENT_DURATION_MS, remainingSeconds, startOrResumeTimebox, SQL_ASSESSMENT_DURATION_MS } from '../src/lib/assessmentTimer.ts';
import { createTimedSqlAssessmentDraft, emptySqlAssessmentDraft, parseSqlAssessmentDraft } from '../src/lib/sqlAssessmentPersistence.ts';

const initial = startOrResumeTimebox({ startedAt: null, deadlineAt: null, marker: 'kept' }, 1_000, GUIDED_ASSESSMENT_DURATION_MS);
assert.equal(initial.startedAt, 1_000);
assert.equal(initial.deadlineAt, 1_000 + GUIDED_ASSESSMENT_DURATION_MS);
assert.equal(initial.marker, 'kept');
assert.equal(remainingSeconds(initial.deadlineAt, 1_000), 45 * 60);
assert.equal(remainingSeconds(initial.deadlineAt, 2_001), 44 * 60 + 59);
assert.equal(remainingSeconds(initial.deadlineAt, initial.deadlineAt), 0, 'expired deadline stays at zero');
assert.equal(formatRemainingTime(0), '00:00');
assert.equal(formatRemainingTime(3_661), '61:01');

const draft = emptySqlAssessmentDraft();
const running = createTimedSqlAssessmentDraft(JSON.stringify({ ...draft, candidate: 'A candidate', query: 'SELECT 1', startedAt: 10_000, deadlineAt: 10_000 + SQL_ASSESSMENT_DURATION_MS }), 20_000);
assert.equal(running.startedAt, 10_000, 'reopening a saved draft does not restart its timer');
assert.equal(running.deadlineAt, 10_000 + SQL_ASSESSMENT_DURATION_MS);
assert.equal(running.candidate, 'A candidate');
assert.equal(running.query, 'SELECT 1');
const expired = createTimedSqlAssessmentDraft(JSON.stringify({ ...draft, startedAt: 10_000, deadlineAt: 11_000 }), 12_000);
assert.equal(expired.deadlineAt, 11_000, 'expired drafts remain expired after reload');
assert.equal(remainingSeconds(expired.deadlineAt, 12_000), 0);
assert.equal(parseSqlAssessmentDraft('{bad json').query, draft.query, 'corrupted draft falls back without throwing');
console.log('assessment workspace timer and draft recovery: pass');
