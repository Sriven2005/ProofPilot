import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { challenges } from '../src/data/challenges.ts';
import { assessmentDomains, createInitialSelection, getTopicAssessments, isAssessmentAvailable, selectAssessment, selectDomain, selectTopic } from '../src/data/assessmentCatalog.ts';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../src/components/DataAnalystAssessment.tsx', import.meta.url), 'utf8');
const workspaceCss = await readFile(new URL('../src/components/DataAnalystAssessment.css', import.meta.url), 'utf8');

assert.deepEqual(assessmentDomains.map(domain => domain.title), ['Data Analytics', 'SQL', 'Python', 'Problem Solving']);
const catalogIds = assessmentDomains.flatMap(domain => domain.topics.flatMap(topic => topic.assessmentIds));
assert.equal(new Set(catalogIds).size, catalogIds.length, 'an implemented assessment appears in exactly one domain/topic');
assert.deepEqual([...catalogIds].sort(), challenges.map(challenge => challenge.id).sort(), 'all real challenges are reachable in the catalog');
assert.ok(assessmentDomains.every(domain => domain.topics.every(topic => getTopicAssessments(domain.id, topic.id).length <= 4)), 'topic selectors expose at most four assessments');

let selection = createInitialSelection();
assert.equal(selection.domainId, 'data-analytics');
assert.equal(selection.topicId, 'exploratory-analysis');
assert.equal(selection.challengeId, 'analyst-retail-sales-decline');
assert.equal(isAssessmentAvailable(selection), true);

selection = selectDomain('sql');
assert.equal(selection.topicId, 'relational-modeling');
assert.equal(selection.challengeId, 'analyst-sql-retention', 'switching domain resets to a valid assessment for that domain');
selection = selectAssessment(selection, 'analyst-sql-retention');
assert.equal(isAssessmentAvailable(selection), true);

selection = selectDomain('python');
assert.equal(selection.challengeId, null, 'switching to an unimplemented domain cannot retain a stale challenge');
assert.equal(isAssessmentAvailable(selection), false);
selection = selectTopic(selection, 'data-processing');
assert.equal(selection.challengeId, null);
assert.equal(isAssessmentAvailable(selection), false);

selection = selectDomain('problem-solving');
selection = selectTopic(selection, 'model-investigation');
selection = selectAssessment(selection, 'ml-degradation');
assert.equal(selection.challengeId, 'ml-degradation');
assert.equal(isAssessmentAvailable(selection), true);
assert.equal(selectAssessment(selection, 'analyst-sql-retention').challengeId, 'ml-degradation', 'an assessment from another topic cannot replace the active selection');

assert.match(appSource, /\?\.topics\.map/);
assert.doesNotMatch(appSource, /challenges\.map\(\(item\) =>/, 'the setup screen no longer renders a flat all-challenges list');
assert.match(appSource, /topicAssessments\.slice\(0, 4\)/);
assert.match(appSource, /disabled\s*>Assessment unavailable/);
assert.match(appSource, /setChallengeId\(candidate\.id\)/, 'the selected assessment is the one passed to the existing start workflow');
assert.match(workspaceSource, /@monaco-editor\/react/);
assert.match(workspaceSource, /language="sql"/);
assert.match(workspaceSource, /actions\.find/);
assert.match(workspaceSource, /void runQueryRef\.current\(\)/, 'Monaco shortcut uses the current SQL execution callback');
assert.match(workspaceSource, /session\.current\.run\(draft\.query\)/, 'editor uses the existing real SQLite execution path');
assert.match(workspaceSource, /lineNumbers: 'on'/);
assert.match(workspaceSource, /folding: true/);
assert.match(workspaceSource, /tabSize: 2/);
assert.match(workspaceCss, /guided-monaco-editor\{[^}]*resize:vertical/);

console.log(JSON.stringify({ domains: assessmentDomains.length, topics: assessmentDomains.reduce((count, domain) => count + domain.topics.length, 0), realAssessments: catalogIds.length, unavailablePythonTopics: assessmentDomains.find(domain => domain.id === 'python')?.topics.length, sqlEditor: 'Monaco bound to existing SQLite query runner' }));
