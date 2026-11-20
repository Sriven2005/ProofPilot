export type RoleId = 'analyst' | 'developer' | 'ml' | 'designer';
export type ChallengeId =
  | 'analyst-retention' | 'analyst-anomaly' | 'analyst-inventory' | 'analyst-sql-retention' | 'analyst-retail-sales-decline'
  | 'developer-api-debug' | 'developer-auth' | 'developer-database'
  | 'ml-overfitting' | 'ml-imbalance' | 'ml-degradation'
  | 'designer-checkout' | 'designer-onboarding' | 'designer-accessibility';
export type View = 'home' | 'setup' | 'workspace' | 'guided' | 'results' | 'report';

export interface Challenge {
  id: ChallengeId;
  roleId: RoleId;
  role: string;
  category: string;
  title: string;
  summary: string;
  duration: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Applied';
  skills: string[];
  scenario: string;
  requirements: string[];
  deliverables: string[];
  context: string;
  evaluationRubricId: ChallengeId;
}

export interface CriterionScore {
  name: string;
  weight: number;
  score: number;
  note: string;
  evidence: string[];
  missing: string[];
  incorrect: string[];
}

export interface Evaluation {
  score: number;
  criteria: CriterionScore[];
  strengths: string[];
  improvements: string[];
  summary: string;
  completedAt: string;
  components?: { deterministicVerification: number; technicalReasoning: number; essentialGateApplied: boolean };
  /** Additive report payload for the Data Analyst guided assessment; legacy score stays uncombined. */
  guidedAssessment?: GuidedAssessmentResult;
}

export interface GuidedSkillResult {
  skill: 'SQL' | 'Data analysis' | 'Statistical interpretation' | 'Problem-solving' | 'Business communication';
  score: number;
  evidence: string[];
  gaps: string[];
}

export interface GuidedQueryEvidence {
  sql: string;
  status: 'success' | 'error';
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated?: boolean;
  error?: string;
  runAt: string;
  assessmentTag?: 'monthly' | 'category' | 'region' | 'other';
  expectedMatch?: boolean;
}

export interface GuidedAssessmentResult {
  problemSolvingScore: number;
  implementationScore: number;
  problemSolvingWeights: { understanding: 15; decomposition: 20; interpretation: 20; evidenceReasoning: 20; recommendations: 25 };
  implementationWeights: { syntax: 20; sqlConcepts: 15; resultCorrectness: 35; usefulCoverage: 20; validation: 10 };
  skillBreakdown: GuidedSkillResult[];
  queryEvidence: GuidedQueryEvidence[];
  understanding: string;
  observations: string;
  interpretation: string;
  recommendations: string;
  reasoning?: string;
}

export interface AssessmentRecord {
  id: string;
  candidate: string;
  challengeId: ChallengeId;
  answer: string;
  evaluation: Evaluation;
  /** Present for account-backed records; legacy browser records remain unchanged. */
  mode?: 'assessment' | 'practice' | 'proof';
  /** Client-computed or imported scores remain explicitly unverified. */
  scoreTrust?: 'client_unverified' | 'server_verified';
}
