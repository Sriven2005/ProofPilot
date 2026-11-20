import assert from 'node:assert/strict';
import { calculateAssessmentProgress } from '../src/lib/progress.ts';
import type { AssessmentRecord } from '../src/types.ts';

const record = (id: string, score: number, completedAt: string, mode?: AssessmentRecord['mode']): AssessmentRecord => ({
  id, candidate: 'Test candidate', challengeId: 'analyst-retention', answer: 'A considered answer', mode,
  evaluation: { score, criteria: [], strengths: [], improvements: [], summary: '', completedAt }
});

const onlyOne = calculateAssessmentProgress([record('a', 62, '2026-01-01T00:00:00Z')]);
assert.equal(onlyOne.length, 1);
assert.equal(onlyOne[0].previous, null);
assert.equal(onlyOne[0].change, null, 'Do not fabricate progress from a single attempt.');

const assessmentProgress = calculateAssessmentProgress([
  record('old', 58, '2026-01-01T00:00:00Z'),
  record('new', 73, '2026-02-01T00:00:00Z'),
  record('practice', 91, '2026-03-01T00:00:00Z', 'practice')
]);
assert.equal(assessmentProgress[0].latest.id, 'new');
assert.equal(assessmentProgress[0].previous?.id, 'old');
assert.equal(assessmentProgress[0].change, 15);
assert.equal(calculateAssessmentProgress([record('practice', 91, '2026-03-01T00:00:00Z', 'practice')], 'assessment').length, 0,
  'Practice results must not leak into assessment progress.');
assert.equal(calculateAssessmentProgress([record('practice', 91, '2026-03-01T00:00:00Z', 'practice')], 'practice').length, 1);
console.log('Assessment progress tests passed (8 assertions).');
