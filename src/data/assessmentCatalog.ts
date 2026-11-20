import { challenges, getChallenge, isChallengeId } from './challenges.ts';
import type { ChallengeId } from '../types.ts';

export type AssessmentDomainId = 'data-analytics' | 'sql' | 'python' | 'problem-solving';

export interface AssessmentTopic {
  id: string;
  title: string;
  description: string;
  assessmentIds: ChallengeId[];
  unavailableMessage?: string;
}

export interface AssessmentDomain {
  id: AssessmentDomainId;
  title: string;
  description: string;
  topics: AssessmentTopic[];
}

// This catalog only marks existing, rubric-backed challenges as available. Empty
// topics remain visible so planned skill areas are clearly labeled as unavailable.
export const assessmentDomains: AssessmentDomain[] = [
  {
    id: 'data-analytics',
    title: 'Data Analytics',
    description: 'Investigate business data, identify patterns, and communicate evidence.',
    topics: [
      { id: 'exploratory-analysis', title: 'Exploratory Analysis', description: 'Work from a supplied retail dataset and verify patterns with SQL.', assessmentIds: ['analyst-retail-sales-decline'] },
      { id: 'business-insights', title: 'Business Insights', description: 'Frame business questions and recommend measurable actions.', assessmentIds: ['analyst-retention', 'analyst-anomaly', 'analyst-inventory'] },
      { id: 'data-cleaning', title: 'Data Cleaning', description: 'Prepare and validate imperfect datasets.', assessmentIds: [], unavailableMessage: 'No dedicated Data Cleaning assessment is implemented yet.' },
      { id: 'statistical-analysis', title: 'Statistical Analysis', description: 'Interpret uncertainty and statistical evidence.', assessmentIds: [], unavailableMessage: 'No dedicated Statistical Analysis assessment is implemented yet.' },
    ],
  },
  {
    id: 'sql',
    title: 'SQL',
    description: 'Model data and answer business questions using SQL.',
    topics: [
      { id: 'relational-modeling', title: 'Relational Modeling & Aggregation', description: 'Build and validate a small relational customer/order dataset.', assessmentIds: ['analyst-sql-retention'] },
      { id: 'joins', title: 'Joins', description: 'Combine related records at the correct grain.', assessmentIds: [], unavailableMessage: 'No dedicated Joins assessment is implemented yet.' },
      { id: 'subqueries', title: 'Subqueries', description: 'Use nested queries to solve analytical tasks.', assessmentIds: [], unavailableMessage: 'No dedicated Subqueries assessment is implemented yet.' },
      { id: 'window-functions', title: 'Window Functions', description: 'Analyze ordered and partitioned data.', assessmentIds: [], unavailableMessage: 'No dedicated Window Functions assessment is implemented yet.' },
    ],
  },
  {
    id: 'python',
    title: 'Python',
    description: 'Python assessment workspaces are planned.',
    topics: [
      { id: 'data-structures', title: 'Data Structures', description: 'Lists, dictionaries, sets, and practical data choices.', assessmentIds: [], unavailableMessage: 'Python assessments are not implemented yet.' },
      { id: 'functions', title: 'Functions', description: 'Decompose work into clear, reusable functions.', assessmentIds: [], unavailableMessage: 'Python assessments are not implemented yet.' },
      { id: 'oop', title: 'Object-Oriented Programming', description: 'Model behavior and state with classes.', assessmentIds: [], unavailableMessage: 'Python assessments are not implemented yet.' },
      { id: 'data-processing', title: 'Data Processing', description: 'Transform and validate practical datasets.', assessmentIds: [], unavailableMessage: 'Python assessments are not implemented yet.' },
    ],
  },
  {
    id: 'problem-solving',
    title: 'Problem Solving',
    description: 'Work through role-specific scenarios using a written response and the existing rubric evaluator.',
    topics: [
      { id: 'engineering-diagnosis', title: 'Engineering Diagnosis', description: 'Plan debugging and performance investigations.', assessmentIds: ['developer-api-debug', 'developer-database'] },
      { id: 'secure-design', title: 'Secure Design', description: 'Reason through authentication and abuse prevention.', assessmentIds: ['developer-auth'] },
      { id: 'model-investigation', title: 'Model Investigation', description: 'Diagnose model quality, imbalance, and degradation.', assessmentIds: ['ml-overfitting', 'ml-imbalance', 'ml-degradation'] },
      { id: 'product-design-cases', title: 'Product Design Cases', description: 'Investigate experience problems and propose measured changes.', assessmentIds: ['designer-checkout', 'designer-onboarding', 'designer-accessibility'] },
    ],
  },
];

export interface AssessmentSelection {
  domainId: AssessmentDomainId;
  topicId: string;
  challengeId: ChallengeId | null;
}

const MAX_TOPIC_ASSESSMENTS = 4;

export const getDomain = (domainId: AssessmentDomainId) => assessmentDomains.find(domain => domain.id === domainId) ?? assessmentDomains[0];
export const getTopic = (domainId: AssessmentDomainId, topicId: string) => getDomain(domainId).topics.find(topic => topic.id === topicId) ?? getDomain(domainId).topics[0];
export const getTopicAssessments = (domainId: AssessmentDomainId, topicId: string) => getTopic(domainId, topicId).assessmentIds.slice(0, MAX_TOPIC_ASSESSMENTS).filter(isChallengeId).map(getChallenge);

export function getSelectionForChallenge(challengeId: ChallengeId): AssessmentSelection {
  for (const domain of assessmentDomains) {
    for (const topic of domain.topics) {
      if (topic.assessmentIds.includes(challengeId)) return { domainId: domain.id, topicId: topic.id, challengeId };
    }
  }
  return { domainId: 'data-analytics', topicId: 'exploratory-analysis', challengeId: challenges[1].id };
}

export function createInitialSelection(challengeId?: ChallengeId): AssessmentSelection {
  return getSelectionForChallenge(challengeId ?? 'analyst-retail-sales-decline');
}

export function selectDomain(domainId: AssessmentDomainId): AssessmentSelection {
  const domain = getDomain(domainId);
  const topic = domain.topics[0];
  const challengeId = topic.assessmentIds.find(isChallengeId) ?? null;
  return { domainId, topicId: topic.id, challengeId };
}

export function selectTopic(selection: AssessmentSelection, topicId: string): AssessmentSelection {
  const domain = getDomain(selection.domainId);
  const topic = domain.topics.find(item => item.id === topicId) ?? domain.topics[0];
  const challengeId = topic.assessmentIds.find(isChallengeId) ?? null;
  return { domainId: domain.id, topicId: topic.id, challengeId };
}

export function selectAssessment(selection: AssessmentSelection, challengeId: ChallengeId): AssessmentSelection {
  if (!getTopic(selection.domainId, selection.topicId).assessmentIds.includes(challengeId)) return selection;
  return { ...selection, challengeId };
}

export function isAssessmentAvailable(selection: AssessmentSelection): boolean {
  return selection.challengeId !== null && getTopicAssessments(selection.domainId, selection.topicId).some(challenge => challenge.id === selection.challengeId);
}
