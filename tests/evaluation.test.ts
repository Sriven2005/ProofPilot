import assert from 'node:assert/strict';
import { challenges } from '../src/data/challenges.ts';
import { challengeRubrics, dimensionWeights } from '../src/data/rubrics.ts';
import { evaluateSubmission } from '../src/lib/evaluation.ts';
import { parseAssessmentDraft, parseAssessmentRecords } from '../src/lib/persistence.ts';

const retention = challenges.find((item) => item.id === 'analyst-retention')!;
const api = challenges.find((item) => item.id === 'developer-api-debug')!;

const cases = {
  empty: '',
  irrelevant: 'I enjoy teamwork, communication, and helping customers. A successful company should create value and grow revenue through good leadership.',
  weak: 'I would measure 90-day repeat purchase rates, compare customer cohorts by acquisition channel, and send everyone a discount.',
  partial: 'Define 90-day repeat purchase rate by customer cohort using first order month. Compare channels and regions to see where the decline is largest. I would test a loyalty discount for those customers and track the repeat purchase rate.',
  good: 'Define repeat as a second order within 90 days after the first. Compare rate by acquisition cohort and channel using mature cohorts. Paid social may bring lower-intent customers; check that segment before deciding. Try a targeted loyalty message for that group and measure repeat purchase rate. The observed pattern is correlational, so validate the offer with a customer holdout.',
  excellent: 'I would define retention as distinct customers with a second paid order within 90 days of their first order, grouped by first-order month and only compare cohorts with a complete 90-day observation window. I would query customer_id and order history, deduplicate orders, exclude refunds, and segment by acquisition channel, region, product category, discount exposure and first-order value. First check whether the drop is concentrated in recent, mature cohorts and validate that the metric and joins did not change. My hypotheses are that paid social brought lower-intent customers or broad discounts changed customer mix; neither is causal from this comparison. I would estimate contribution margin and repeat behavior by segment, then run a randomized holdout for a targeted loyalty offer among the affected cohort instead of discounting everyone. Primary success is incremental 90-day repeat purchase rate; guardrails are contribution margin, refund rate and unsubscribes. Pre-register the comparison, wait for labels/cohorts to mature, and stop if margin falls beyond an agreed threshold.',
  validAlternative: 'I would trace the order intent through payment and order-service logs using a correlation ID. Instead of retrying payment synchronously in the browser, persist a durable payment intent with a unique request ID and provider idempotency key, then let a worker process it and reconcile the final status from provider webhooks. A timeout remains an unknown state, not a failed charge. A database uniqueness constraint prevents duplicate order creation; the webhook and worker are idempotent. I would test replayed webhooks, duplicate requests and delayed provider responses, then canary the change while monitoring unresolved intents and duplicate charges.',
  keywordHeavyWrong: 'Idempotency key, payment provider, pending, retry, order, reconcile, request ID, timeout, monitoring, test. Retry with a new idempotency key every time so the provider processes it again. Immediately mark the order failed when a payment request times out because a timeout proves the charge did not happen. This is safe and prevents duplicates.'
};

const scores = Object.fromEntries(Object.entries(cases).map(([name, answer]) => [name, evaluateSubmission(answer, name === 'validAlternative' || name === 'keywordHeavyWrong' ? api : retention).score]));

assert.equal(scores.empty, 0, 'empty answer must score zero');
assert.ok(scores.irrelevant <= 5, `irrelevant answer score ${scores.irrelevant} should be 0–5`);
assert.ok(scores.weak >= 10 && scores.weak <= 25, `weak answer score ${scores.weak} should be 10–25`);
assert.ok(scores.partial >= 30 && scores.partial <= 50, `partial answer score ${scores.partial} should be 30–50`);
assert.ok(scores.good >= 55 && scores.good <= 70, `good answer score ${scores.good} should be 55–70`);
assert.ok(scores.excellent >= 90, `excellent answer score ${scores.excellent} should reach 90+`);
assert.ok(scores.validAlternative >= 75, `valid alternative score ${scores.validAlternative} should be recognized`);
assert.ok(scores.keywordHeavyWrong <= 25, `keyword-heavy incorrect answer score ${scores.keywordHeavyWrong} should stay low`);

const empty = evaluateSubmission('', retention);
assert.equal(empty.score, 0);
assert.ok(empty.criteria.every((criterion) => criterion.score === 0));
assert.deepEqual(empty.criteria.map((criterion) => criterion.weight), [15, 25, 20, 25, 15]);
const repeat = evaluateSubmission(cases.excellent, retention);
assert.equal(repeat.score, scores.excellent, 'same submission should produce the same score');
assert.ok(repeat.criteria.every((criterion) => criterion.note.length > 20), 'each criterion needs a rationale');
assert.ok(repeat.improvements.some((item) => item.includes('A stronger response would demonstrate')));
const savedRecord = { id: 'PP-2026-ABC123', candidate: 'QA Candidate', challengeId: retention.id, answer: cases.excellent, evaluation: repeat };
assert.deepEqual(parseAssessmentRecords(JSON.stringify([savedRecord])), [savedRecord], 'current local records round-trip');
const sqlChallenge = challenges.find((item) => item.id === 'analyst-sql-retention')!;
const sqlHistory = { ...savedRecord, id: 'PP-2026-SQL001', challengeId: sqlChallenge.id, evaluation: { ...repeat, components: { deterministicVerification: 92, technicalReasoning: 84, essentialGateApplied: false } } };
assert.equal(parseAssessmentRecords(JSON.stringify([sqlHistory]))[0]?.challengeId, sqlChallenge.id, 'SQL challenge records remain valid in assessment history');
assert.deepEqual(parseAssessmentRecords(JSON.stringify([sqlHistory]))[0]?.evaluation.components, sqlHistory.evaluation.components, 'SQL component scores survive local history round-trip');
assert.equal(parseAssessmentRecords('{broken json').length, 0, 'corrupt JSON is ignored safely');
assert.equal(parseAssessmentRecords(JSON.stringify({ records: [savedRecord] })).length, 0, 'unexpected storage shapes are ignored safely');
assert.equal(parseAssessmentRecords(JSON.stringify([{ ...savedRecord, challengeId: 'not-a-role-or-challenge' }])).length, 0, 'unknown challenge IDs are rejected');
assert.equal(parseAssessmentRecords(JSON.stringify([{ ...savedRecord, evaluation: { score: 98 } }])).length, 0, 'incomplete evaluations are rejected safely');
const legacyRecord = parseAssessmentRecords(JSON.stringify([{ ...savedRecord, challengeId: 'developer' }]));
assert.equal(legacyRecord[0]?.challengeId, 'developer-api-debug', 'role-keyed historical record migrates to its canonical challenge');
assert.equal(parseAssessmentRecords(JSON.stringify([{ ...savedRecord, challengeId: undefined, role: 'AI/ML Engineer' }]))[0]?.challengeId, 'ml-degradation', 'display-name historical record migrates to its canonical challenge');
assert.equal(parseAssessmentRecords(JSON.stringify([savedRecord, { ...savedRecord, id: 'PP-2026-DEF456', challengeId: 'designer' }])).length, 2, 'multiple valid assessment records remain available');
const migratedDraft = parseAssessmentDraft(JSON.stringify({ roleId: 'ml', candidate: 'Draft', answer: 'Working notes' }));
assert.deepEqual(migratedDraft, { challengeId: 'ml-degradation', candidate: 'Draft', answer: 'Working notes' }, 'legacy role draft restores safely');
assert.equal(parseAssessmentDraft('{broken json'), null, 'corrupt drafts are ignored safely');
const auth = challenges.find((item) => item.id === 'developer-auth')!;
const insecureAuth = evaluateSubmission('Credential stuffing is a risk, so use email login and a passkey. Store passwords in plain text for recovery. Revoke sessions after sign out. Test recovery and monitor login failure rates.', auth);
assert.ok(insecureAuth.criteria.find((criterion) => criterion.name === 'Technical correctness')?.incorrect.includes('Passwords must never be stored in plaintext.'), 'unsupported insecure claims are identified in criterion feedback');
assert.equal(challenges.length, 14, 'all 14 challenges should be available');
assert.equal(new Set(challenges.map((item) => item.id)).size, 14, 'challenge IDs must be unique');
assert.equal(new Set(challenges.map((item) => item.scenario.trim())).size, 14, 'challenge scenarios must be distinct');
assert.equal(Object.keys(challengeRubrics).length, 14, 'every challenge must have its own rubric');
for (const roleId of ['analyst', 'developer', 'ml', 'designer']) {
  assert.equal(challenges.filter((item) => item.roleId === roleId).length, roleId === 'analyst' ? 5 : 3, `${roleId} needs its expected distinct challenges`);
}
assert.equal(Object.values(dimensionWeights).reduce((sum, weight) => sum + weight, 0), 100, 'criterion weights must total 100%');
for (const challenge of challenges) {
  assert.ok(challenge.scenario.trim().length >= 100, `${challenge.id} needs a realistic scenario`);
  assert.ok(challenge.context.trim().length >= 40, `${challenge.id} needs relevant constraints and context`);
  assert.equal(challenge.requirements.length, 3, `${challenge.id} must have three clear tasks`);
  assert.ok(challenge.deliverables.length >= 3, `${challenge.id} must specify expected deliverables`);
  assert.ok(challenge.skills.length >= 3, `${challenge.id} must identify role-specific skills`);
  assert.match(challenge.duration, /^\d+ min$/, `${challenge.id} must specify a completion estimate`);
  assert.ok(['Beginner', 'Intermediate', 'Advanced', 'Applied'].includes(challenge.difficulty), `${challenge.id} must specify a valid difficulty`);
  assert.ok(challengeRubrics[challenge.id], `missing rubric for ${challenge.id}`);
  assert.equal(challenge.evaluationRubricId, challenge.id, `${challenge.id} must point to its own rubric`);
  assert.equal(challengeRubrics[challenge.id].taskEvidence.length, challenge.requirements.length, `${challenge.id} needs one task anchor per requested task`);
  assert.ok(challengeRubrics[challenge.id].strongCandidate.length > 50, `${challenge.id} needs a challenge-specific strong-candidate description`);
  const unrelated = evaluateSubmission('This answer talks about cooking dinner, and does not address the scenario.', challenge);
  assert.equal(unrelated.score, 0, `${challenge.id} should not reward unrelated content`);
  assert.deepEqual(unrelated.criteria.map((criterion) => criterion.weight), [15, 25, 20, 25, 15]);
}

const roleScenarios = [
  {
    role: 'Data Analyst', challengeId: 'analyst-retention', answers: {
      empty: '',
      irrelevant: 'I enjoy teamwork and communication. Strong leaders help customers and create value through positive culture.',
      weak: 'I would measure 90-day repeat purchase rates, compare customer cohorts by acquisition channel, and send everyone a discount.',
      generic: 'I would look at the numbers, understand customers, and make a plan to improve the business.',
      partial: 'Define 90-day repeat purchase rate by customer cohort using first order month. Compare channels and regions to see where the decline is largest. I would test a loyalty discount for those customers and track the repeat purchase rate.',
      reasonable: 'Define repeat as a second purchase within 90 days of the first. Compare repeat rate by acquisition cohort and channel, using mature 90-day windows. Paid social customers appear less likely to return, so target a loyalty offer at that segment and measure 90-day repeat purchase rate. This is only an association, so test the offer with a customer holdout and protect contribution margin.',
      strong: 'Define distinct customers with a second paid order within 90 days, grouped by first-order month and compare only mature cohorts. Query order history and segment by channel, region, product and discount exposure; verify the decline is not from a metric or join change. Paid social may have changed customer mix, but this is not causal evidence. I would target a loyalty offer to the affected segment and track its 90-day repeat rate.',
      excellent: cases.excellent,
      alternative: 'I define retention as distinct customers with a second paid order within 90 days of their first. I would compare mature rates by first order month, channel and product, and check whether the change is concentrated in customers exposed to the new paid-social campaign. This is an association, not proof of cause. Rather than adding another discount, target the affected category with a post-purchase product education message using a randomized holdout. Measure incremental second-order rate and guard contribution margin and unsubscribe rate; wait until every cohort has a full 90-day window, pre-register the test, and stop if margin falls below the agreed limit.',
      keywordWrong: '90-day retention cohorts, SQL, customer data, acquisition channels, discount, experiment, metric, repeat purchase. Discounts always cause retention, revenue growth proves repeat customers are loyal, and we should give everyone another discount without a control group.'
    }
  },
  {
    role: 'Software Developer', challengeId: 'developer-api-debug', answers: {
      empty: '',
      irrelevant: 'A good team communicates and delivers value. Customer satisfaction and company growth are important.',
      weak: 'I would correlate the payment provider timeout with order-service logs to see where the request stopped.',
      generic: 'I would inspect the service, fix the bug, and add tests so users have a better experience.',
      partial: 'Trace the payment timeout and duplicate order reports in the logs. Reuse the same provider idempotency key across retries and test duplicate requests.',
      reasonable: 'Trace payment and order requests with a correlation ID to find where the timeout occurs. Keep the same provider idempotency key across retries, and reconcile a timed-out payment before deciding whether the order failed. Test duplicate requests and monitor duplicate charges. Canary the fix on a small share of traffic and roll back if duplicates rise.',
      strong: 'Propagate a request ID across browser, payment provider and order service logs, and inspect whether provider success can happen before the order write. Keep the same idempotency key across retries; treat timeout as unknown and reconcile provider status before creating the order. Test duplicate requests and delayed provider responses. Monitor unresolved intents and duplicate charges.',
      excellent: cases.validAlternative,
      alternative: 'I would not make the browser retry payment. Persist a durable payment intent with a unique request ID and provider idempotency key, carry that ID into payment and order logs, then let a worker process it and reconcile its status from signed provider webhooks. A timeout remains unknown. A uniqueness constraint prevents duplicate order writes. Test duplicate webhooks and delayed provider responses, then canary while monitoring unresolved intents and duplicate charges.',
      keywordWrong: cases.keywordHeavyWrong
    }
  },
  {
    role: 'AI/ML Engineer', challengeId: 'ml-degradation', answers: {
      empty: '',
      irrelevant: 'Communication, teamwork, customer value, leadership, and company growth are important for a successful project.',
      weak: 'Precision fell from 91% to 76% in the new market and false positives increased while recall stayed stable. Check device feature distributions, then lower the threshold and immediately retrain on this week\'s labels.',
      generic: 'I would inspect the data and improve the model, then monitor it to make sure it works well.',
      partial: 'Wait for the 14-day labels to mature, then compare precision by market and device. Check whether the new device vendor changed feature values and monitor false positives after a threshold change.',
      reasonable: 'Wait until labels are mature and compare precision and recall by market, device vendor and merchant against a reference market. Check missingness and feature distributions after the vendor launch. A threshold adjustment may reduce review load; test it in shadow mode and monitor false positives and review volume.',
      strong: 'First wait for matured labels and compare data quality, feature distributions and precision/recall across market, vendor and merchant slices against a reference cohort. Separate covariate drift from label delay and calibration. Shadow a threshold or calibration adjustment before a canary, evaluate the queue impact and subgroup error, and roll back if false positives or fairness gaps cross agreed limits.',
      excellent: 'Do not compare immature labels. After the 14-day window, audit schema and missingness for the new device vendor, then compute precision, recall and calibration by market, vendor, merchant and relevant customer subgroups against a matured reference market cohort. Distinguish feature drift, label delay and threshold calibration. Run a shadow challenger, then a limited canary using a threshold chosen for review capacity. Monitor false positives, queue volume and subgroup error; roll back if subgroup false-positive rate exceeds the pre-set limit.',
      alternative: 'Keep the current model live and audit schema, missingness, and feature distributions for the new device vendor. Treat the label delay separately from input drift. Run a champion-challenger shadow evaluation in the new market. Wait for 14-day labels to mature, then compare calibration and precision by vendor and merchant slice with the reference market. If the score distribution shifted, recalibrate the threshold using held-out matured data, canary it, and monitor queue size and subgroup false-positive rates with a rollback trigger.',
      keywordWrong: 'Drift, label delay, precision, recall, fairness, threshold, calibration and new market are all important. Recall is unchanged so ignore the precision drop and false positives. Immediately retrain on this week’s labels and ship the threshold change to everyone without waiting for labels.'
    }
  },
  {
    role: 'UI/UX Designer', challengeId: 'designer-onboarding', answers: {
      empty: '',
      irrelevant: 'A strong brand should delight customers, grow revenue, and improve collaboration across the company.',
      weak: 'The invite step may be where teams drop off. Let them create a project before asking for invites, then count first project creations.',
      generic: 'I would talk to users, simplify the experience, and measure success after launch.',
      partial: 'Inspect the onboarding funnel by step and interview new teams about friction. Let them create a project before inviting everyone and show a sample task in the empty state. Track first-project creation.',
      reasonable: 'Compare invite completion for solo evaluators and teams. Move the invite screen after project creation, and show a starter task with a next action. Track first-project creation as the success metric.',
      strong: 'Segment the funnel by solo versus team users and combine step drop-off with observed first-session usability tests. Let a user create or preview a project before asking for invites or notification settings; use a starter task and clear next action in the empty state. Run an experiment on first-project rate and time to value, with team activation and invite completion as guardrails.',
      excellent: 'I would compare funnel completion by solo evaluator and team size, then observe first-session usability sessions to locate the point where setup feels like work before value. Prototype a short path that creates a project immediately, offers a realistic starter task and a clear next action, and defers invites and preferences until users choose to collaborate. Randomize the flow and measure first-project rate and time to first value; guard team activation, invite completion and early retention.',
      alternative: 'Offer solo evaluators a read-only sample workspace before asking for team details. Compare activation by team size and interview preview users about the first session. Let them try a starter task, then progressively disclose project setup and defer invites until they have seen value. A/B test first-project activation and time to first value, and guard team activation and retention.',
      keywordWrong: 'Funnel, activation, sample project, empty state, progressive disclosure, invite, experiment, retention. Force all five invites and notification settings before allowing project creation, because more onboarding friction ensures better activation.'
    }
  }
];

const deepScores: Record<string, number[]> = {};
for (const group of roleScenarios) {
  const challenge = challenges.find((item) => item.id === group.challengeId)!;
  const labels = Object.keys(group.answers) as Array<keyof typeof group.answers>;
  const roleScores = labels.map((label) => {
    const result = evaluateSubmission(group.answers[label], challenge);
    assert.equal(result.criteria.reduce((total, item) => total + item.weight, 0), 100, `${group.role} criterion weights must total 100`);
    assert.equal(result.score, Math.round(result.criteria.reduce((total, item) => total + item.score * item.weight, 0) / 100), `${group.role} overall score must use the weighted criteria`);
    assert.ok(result.criteria.every((criterion) => criterion.note.length > 20), `${group.role} needs criterion-level reasons`);
    return result.score;
  });
  deepScores[group.role] = roleScores;
  assert.equal(roleScores.length, 10);
  assert.equal(roleScores[0], 0, `${group.role} empty response`);
  assert.ok(roleScores[1] <= 5, `${group.role} irrelevant response ${roleScores[1]}`);
  assert.ok(roleScores[2] >= 10 && roleScores[2] <= 25, `${group.role} weak response ${roleScores[2]}`);
  assert.ok(roleScores[4] >= 30 && roleScores[4] <= 50, `${group.role} partial response ${roleScores[4]}`);
  assert.ok(roleScores[5] >= 55 && roleScores[5] <= 70, `${group.role} reasonable response ${roleScores[5]}`);
  assert.ok(roleScores[6] >= 75 && roleScores[6] <= 89, `${group.role} strong response ${roleScores[6]}`);
  assert.ok(roleScores[7] >= 90, `${group.role} excellent response ${roleScores[7]}`);
  assert.ok(roleScores[8] >= 75, `${group.role} alternative solution ${roleScores[8]}`);
  assert.ok(roleScores[9] <= 25, `${group.role} keyword-heavy wrong response ${roleScores[9]}`);
}

console.log('Evaluator calibration passed (8 baseline + 40 cross-role cases):', { ...scores, deepScores });
