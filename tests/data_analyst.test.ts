import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { retailSalesRows, RETAIL_DATASET_SCHEMA, retailSalesCsv } from '../src/data/retailSales.ts';
import { evaluateDataAnalystAssessment, hasRetailDatasetExploration, hasVerifiedPerformanceBreakdown, PROBLEM_SOLVING_WEIGHTS, IMPLEMENTATION_WEIGHTS } from '../src/lib/dataAnalystEvaluation.ts';
import { executeBoundedReadOnlyQuery, validateReadOnlySql } from '../src/lib/sqlSafety.ts';
import { parseAssessmentRecords } from '../src/lib/persistence.ts';
import { parseGuidedAssessmentDraft } from '../src/lib/guidedAssessmentPersistence.ts';
import { challenges, getChallengesForRole } from '../src/data/challenges.ts';

const uniqueOrderIds = new Set(retailSalesRows.map(row => row.order_id));
assert.equal(retailSalesRows.length, 216, 'dataset includes 6 months × 3 regions × 12 products');
assert.equal(uniqueOrderIds.size, retailSalesRows.length, 'synthetic order-line identifiers are unique');
assert.ok(retailSalesRows.every(row => Math.abs(row.revenue - Number((row.quantity * row.unit_price * (1 - row.discount)).toFixed(2))) < 0.001), 'every net revenue value matches its documented formula');
assert.equal(retailSalesCsv().split('\n').length, retailSalesRows.length + 1, 'downloadable CSV includes every row and a header');
assert.equal(getChallengesForRole('analyst').some(challenge => challenge.id === 'analyst-retail-sales-decline'), true);
assert.equal(challenges.filter(challenge => challenge.id === 'analyst-retail-sales-decline').length, 1);
assert.equal(challenges.filter(challenge => challenge.roleId !== 'analyst').some(challenge => challenge.id === 'analyst-retail-sales-decline'), false);
assert.equal(Object.values(PROBLEM_SOLVING_WEIGHTS).reduce((sum, value) => sum + value, 0), 100, 'problem-solving dimension weights total 100');
assert.equal(Object.values(IMPLEMENTATION_WEIGHTS).reduce((sum, value) => sum + value, 0), 100, 'implementation dimension weights total 100');

const SQL = await initSqlJs({ locateFile: file => resolve('node_modules/sql.js/dist', file) });
const db = new SQL.Database();
db.run(RETAIL_DATASET_SCHEMA);
const insert = db.prepare('INSERT INTO retail_sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
try {
  for (const row of retailSalesRows) insert.run([row.order_id, row.order_date, row.product_id, row.product_name, row.category, row.region, row.quantity, row.unit_price, row.discount, row.revenue]);
} finally { insert.free(); }
const monthly = executeBoundedReadOnlyQuery(db, "SELECT strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY month ORDER BY month");
assert.equal(monthly.rows.length, 6);
assert.ok(Number(monthly.rows[5][1]) < Number(monthly.rows[2][1]), 'last three months show a meaningful decline from December');
assert.ok(Number(monthly.rows[3][1]) > Number(monthly.rows[4][1]) && Number(monthly.rows[4][1]) > Number(monthly.rows[5][1]), 'sales decline month over month across the final three months');
const categories = executeBoundedReadOnlyQuery(db, 'SELECT category, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY category ORDER BY category');
assert.equal(categories.rows.length, 4);
const regions = executeBoundedReadOnlyQuery(db, 'SELECT region, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY region ORDER BY region');
assert.equal(regions.rows.length, 3);
const regionsByMonth = executeBoundedReadOnlyQuery(db, "SELECT region, strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY region, month ORDER BY region, month");
assert.equal(regionsByMonth.rows.length, 18);
const capped = executeBoundedReadOnlyQuery(db, 'SELECT * FROM retail_sales');
assert.equal(capped.rows.length, 200);
assert.equal(capped.truncated, true, 'workspace output is capped at 200 rows');
assert.throws(() => executeBoundedReadOnlyQuery(db, 'SELECT 1 AS a,1 AS b,1 AS c,1 AS d,1 AS e,1 AS f,1 AS g,1 AS h,1 AS i,1 AS j,1 AS k,1 AS l,1 AS m,1 AS n,1 AS o,1 AS p,1 AS q,1 AS r,1 AS s,1 AS t,1 AS u,1 AS v,1 AS w,1 AS x,1 AS y,1 AS z,1 AS aa,1 AS ab,1 AS ac,1 AS ad,1 AS ae,1 AS af'), /30 columns/);
assert.throws(() => executeBoundedReadOnlyQuery(db, "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200) SELECT printf('%0500d',x) AS large_value,printf('%0500d',x) AS another_value,printf('%0500d',x) AS third_value FROM n"), /50 KB/);
assert.throws(() => validateReadOnlySql('DELETE FROM retail_sales'), /Only read-only SELECT/);
assert.throws(() => validateReadOnlySql('SELECT 1; DROP TABLE retail_sales'), /not allowed|one SQL statement/);
assert.throws(() => validateReadOnlySql('SELECT * FROM retail_sales; PRAGMA table_info(retail_sales)'), /not allowed|one SQL statement/);
assert.throws(() => executeBoundedReadOnlyQuery(db, "SELECT load_extension('x')"), /not allowed/);
assert.equal(executeBoundedReadOnlyQuery(db, "SELECT 'DROP TABLE' AS note").rows[0][0], 'DROP TABLE', 'keywords inside string literals are not mistaken for writes');
assert.equal(db.exec('SELECT COUNT(*) FROM retail_sales')[0].values[0][0], 216, 'read-only queries have not changed the dataset');

const queries = [
  { sql: "SELECT strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY month ORDER BY month", status: 'success' as const, columns: monthly.columns, rows: monthly.rows, rowCount: monthly.rowCount, runAt: new Date().toISOString() },
  { sql: 'SELECT category, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY category ORDER BY category', status: 'success' as const, columns: categories.columns, rows: categories.rows, rowCount: categories.rowCount, runAt: new Date().toISOString() },
  { sql: 'SELECT region, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY region ORDER BY region', status: 'success' as const, columns: regions.columns, rows: regions.rows, rowCount: regions.rowCount, runAt: new Date().toISOString() },
];
assert.equal(hasVerifiedPerformanceBreakdown([queries[0]]), false, 'one monthly query cannot mark the full performance investigation complete');
assert.equal(hasVerifiedPerformanceBreakdown(queries), true, 'all verified monthly, category, and region results complete the investigation');
assert.equal(hasRetailDatasetExploration([{ sql: 'SELECT 1 AS value', status: 'success', columns: ['value'], rows: [[1]], rowCount: 1, runAt: new Date().toISOString() }]), false, 'a non-dataset query cannot complete exploration');
assert.equal(hasRetailDatasetExploration([queries[0]]), true, 'a successful query over the supplied retail table completes exploration');
const regionalCrossTab = { sql: "SELECT region, strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY region, month ORDER BY region, month", status: 'success' as const, columns: regionsByMonth.columns, rows: regionsByMonth.rows, rowCount: regionsByMonth.rowCount, runAt: new Date().toISOString() };
assert.equal(evaluateDataAnalystAssessment({ candidate: '', understanding: '', observations: '', interpretation: '', recommendations: '', queries: [regionalCrossTab] }).guidedAssessment?.queryEvidence[0].expectedMatch, true, 'valid region-by-month breakdown aggregates to the expected regional totals');
const alternativeMonthlyRows = executeBoundedReadOnlyQuery(db, 'SELECT substr(order_date, 1, 7) AS period, ROUND(SUM(revenue), 2) AS sales FROM retail_sales GROUP BY period ORDER BY period');
const alternative = evaluateDataAnalystAssessment({ candidate: 'Alternative', understanding: '', observations: '', interpretation: '', recommendations: '', queries: [{ sql: 'SELECT substr(order_date, 1, 7) AS period, ROUND(SUM(revenue), 2) AS sales FROM retail_sales GROUP BY period ORDER BY period', status: 'success', columns: alternativeMonthlyRows.columns, rows: alternativeMonthlyRows.rows, rowCount: alternativeMonthlyRows.rowCount, runAt: new Date().toISOString() }] });
assert.equal(alternative.guidedAssessment?.queryEvidence[0].expectedMatch, true, 'valid substr/date alias alternative is recognized by output, not exact query text');
const octToMarchPercent = (Number(monthly.rows[0][1]) - Number(monthly.rows[5][1])) / Number(monthly.rows[0][1]) * 100;
const goodText = `Revenue fell month over month from December through March; March was ${octToMarchPercent.toFixed(1)}% below October in my comparison. I compared revenue by month, category and region. The coastal region and Home category are areas to investigate. Discounts may have contributed, but this data does not prove causation because costs, campaign exposure and customer demand are not included. I recommend testing a targeted offer in the affected segment against a holdout, tracking net revenue and gross margin for four weeks as a measured pilot.`;
const good = evaluateDataAnalystAssessment({ candidate: 'Test Candidate', understanding: 'I will compare monthly net revenue over the last three months against the prior six-month baseline, then check units, discount, region and category.', observations: 'Monthly revenue trends down after December; regional and category aggregates show where to investigate.', interpretation: goodText, recommendations: 'Run a four-week targeted offer test for the affected segment because its revenue fell, compare with a holdout, and measure net revenue while guarding gross margin. Discounting may be a hypothesis, not established cause.', queries });
assert.equal(good.guidedAssessment?.queryEvidence.filter(query => query.expectedMatch).length, 3, 'all three actual aggregate result groups match the deterministic dataset');
assert.ok(good.guidedAssessment!.implementationScore >= 75, `correct executable analysis should score strongly (got ${good.guidedAssessment!.implementationScore})`);
assert.equal(good.improvements.length, 0, 'complete evidence should not receive contradictory generic missing-evidence recommendations');
const fromToInterpretation = evaluateDataAnalystAssessment({ candidate: 'Candidate', understanding: 'Compare monthly revenue over the last three months against the previous period.', observations: 'Revenue fell from December through March.', interpretation: 'Revenue fell from $14,937.35 in December to $5,462.94 in March, a decline of 63.4%. The trend is observed; cause remains uncertain.', recommendations: 'Test the affected region in a four-week pilot against a holdout and measure revenue while guarding margin. Possible discount effects are a hypothesis.', queries });
assert.equal(fromToInterpretation.criteria.find(criterion => criterion.name === 'Interpretation and patterns')?.incorrect.some(item => item.includes('could not be verified')), false, 'month-pair phrasing with values between month names still verifies against actual query output');
const fromOctoberToMarch = evaluateDataAnalystAssessment({ candidate: 'Candidate', understanding: 'Compare monthly revenue across the six month period.', observations: 'Revenue fell over the latest three months.', interpretation: `Revenue fell from October to March by ${octToMarchPercent.toFixed(1)}%; this is observed, while the cause remains uncertain.`, recommendations: 'Test a possible offer change with a four-week holdout and track revenue and margin.', queries });
assert.equal(fromOctoberToMarch.criteria.find(criterion => criterion.name === 'Interpretation and patterns')?.incorrect.some(item => item.includes('could not be verified')), false, 'month names containing the word “to” do not confuse explicit from-to parsing');
const wrongNumeric = evaluateDataAnalystAssessment({ candidate: 'Candidate', understanding: 'I will compare monthly net revenue across the period and inspect category and region.', observations: 'Revenue is declining month by month.', interpretation: goodText.replace(`${octToMarchPercent.toFixed(1)}%`, '32%'), recommendations: 'Test an intervention against a holdout and measure net revenue and gross margin.', queries });
assert.ok(wrongNumeric.guidedAssessment!.problemSolvingScore < good.guidedAssessment!.problemSolvingScore, 'unsupported percentage claims reduce reasoning credit');
assert.ok(wrongNumeric.criteria.find(criterion => criterion.name === 'Interpretation and patterns')?.incorrect.some(item => item.includes('could not be verified')));
const unsupportedCause = evaluateDataAnalystAssessment({ candidate: 'Candidate', understanding: 'Compare monthly sales over the last three months to the prior period.', observations: 'Revenue fell month over month.', interpretation: 'Discounts caused the decline.', recommendations: 'Increase discounts because they caused the decline. Track revenue.', queries });
assert.ok(unsupportedCause.criteria.find(criterion => criterion.name === 'Business recommendations')!.score < good.criteria.find(criterion => criterion.name === 'Business recommendations')!.score, 'an unsupported causal recommendation loses business-communication credit');
assert.ok(unsupportedCause.criteria.find(criterion => criterion.name === 'Business recommendations')?.incorrect.some(item => item.includes('unverified cause')));

const withSyntaxFailure = evaluateDataAnalystAssessment({ candidate: 'Test Candidate', understanding: 'I will compare monthly net revenue over the last three months against the prior six-month baseline, then check units, discount, region and category.', observations: 'Monthly revenue trends down after December; regional and category aggregates show where to investigate.', interpretation: goodText, recommendations: 'Run a four-week targeted offer test for the affected segment because its revenue fell, compare with a holdout, and measure net revenue while guarding gross margin. Discounting may be a hypothesis, not established cause.', queries: [...queries, { sql: 'SELECT FROM retail_sales', status: 'error', columns: [], rows: [], rowCount: 0, error: 'near FROM: syntax error', runAt: new Date().toISOString() }] });
assert.equal(withSyntaxFailure.guidedAssessment?.problemSolvingScore, good.guidedAssessment?.problemSolvingScore, 'a syntax error after successful analysis does not erase reasoning evidence');
assert.ok(withSyntaxFailure.guidedAssessment!.implementationScore < good.guidedAssessment!.implementationScore, 'syntax failure affects implementation score');

const empty = evaluateDataAnalystAssessment({ candidate: '', understanding: '', observations: '', interpretation: '', recommendations: '', queries: [] });
assert.equal(empty.guidedAssessment?.problemSolvingScore, 0);
assert.equal(empty.guidedAssessment?.implementationScore, 0);
const irrelevant = evaluateDataAnalystAssessment({ candidate: '', understanding: 'I like teamwork and hard work.', observations: '', interpretation: 'The company should hire more people.', recommendations: 'Buy more ads and improve everything.', queries: [] });
assert.ok(irrelevant.guidedAssessment!.problemSolvingScore < 30);
assert.equal(irrelevant.guidedAssessment?.implementationScore, 0);
const keywordHeavy = evaluateDataAnalystAssessment({ candidate: '', understanding: 'Sales revenue monthly comparison category region.', observations: '', interpretation: 'The data proves discounts caused all losses and revenue decline in the last three months.', recommendations: 'Immediately increase discounts because discount, revenue, SQL and regions. Track metrics.', queries: [] });
assert.ok(keywordHeavy.guidedAssessment!.problemSolvingScore < 60, `unsupported keyword-heavy claims are capped (got ${keywordHeavy.guidedAssessment!.problemSolvingScore})`);

const raw = JSON.stringify([{ id: 'PP-GUIDED-1', candidate: 'Test Candidate', challengeId: 'analyst-retail-sales-decline', answer: goodText, evaluation: good, scoreTrust: 'client_unverified' }]);
const restored = parseAssessmentRecords(raw);
assert.equal(restored.length, 1);
assert.equal(restored[0].evaluation.guidedAssessment?.implementationScore, good.guidedAssessment?.implementationScore);
assert.equal(restored[0].evaluation.guidedAssessment?.queryEvidence.length, 3, 'completed query evidence survives LocalStorage-compatible normalization');
const recoveredDraft = parseGuidedAssessmentDraft(JSON.stringify({ candidate: 'Recovered', understanding: 'Start with the monthly trend.', query: 'SELECT * FROM retail_sales', currentStep: 3, queries }));
assert.equal(recoveredDraft.candidate, 'Recovered');
assert.equal(recoveredDraft.queries.length, 3, 'refresh recovery restores executed query evidence');
assert.equal(recoveredDraft.currentStep, 3, 'refresh recovery restores current workflow step');
assert.equal(parseGuidedAssessmentDraft('{bad json').candidate, '', 'corrupt guided draft recovers safely without mutating unrelated storage');
assert.equal(parseGuidedAssessmentDraft(JSON.stringify({ currentStep: 99 })).currentStep, 5, 'recovered workflow step is bounded to the final step');
db.close();
console.log(JSON.stringify({ datasetRows: retailSalesRows.length, queryGroups: 3, cappedRows: capped.rows.length, problemSolving: good.guidedAssessment?.problemSolvingScore, implementation: good.guidedAssessment?.implementationScore, syntaxFailureProblemSolving: withSyntaxFailure.guidedAssessment?.problemSolvingScore, syntaxFailureImplementation: withSyntaxFailure.guidedAssessment?.implementationScore, persistence: 'passed' }));
