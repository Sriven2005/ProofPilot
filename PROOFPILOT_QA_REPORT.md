# ProofPilot — Deep QA Report

**Audit date:** 2026-11-06
**Project:** `E:\My Projects\ProofPilot`
**Scope:** application logic, challenge library, deterministic evaluator, assessment and report workflows, local persistence, build and lint. CSS files and visual styling were left unchanged.

## 1. Executive summary

ProofPilot now has a materially safer deterministic evaluator, twelve distinct role-specific challenges, tested cross-role scoring, and draft recovery after refresh. Empty submissions now produce a zero-score result. Current automated calibration gives unrelated answers 0, very weak answers 15–23, partial answers 33–40, reasonable answers 58–68, strong answers 77–88, excellent answers 93–100, and keyword-heavy incorrect answers 5–21 across the four roles.

The final weighted quality score is **74.1/100**, above the internal 70% MVP target. This is an engineering readiness estimate from the checks below, not a scientifically validated hiring measure. The largest remaining product gap is recruiter transparency: reports show scores and rubric explanations but do not show the candidate’s submitted answer, and the app does not provide a visible history picker for older assessments. Deterministic text-pattern scoring also remains brittle to phrasing and unlisted misconceptions.

## 2. Overall and category scores

| Category | Score | Weight | Weighted points | Evidence and limits |
|---|---:|---:|---:|---|
| Functional reliability | 82 | 20% | 16.4 | Challenge selection, draft recovery, empty submission, saved result navigation, and report flow were exercised. History navigation and some browser edge cases remain incomplete. |
| Evaluation accuracy | 68 | 25% | 17.0 | 40 role-specific responses and 8 baseline cases passed their target bands. Scores still depend on curated patterns, not human-calibrated blind evaluation. |
| Challenge quality | 82 | 15% | 12.3 | All 12 scenarios are distinct, constrained, role-specific, and tied to their own rubrics. Candidate-visible deliverables are not rendered in the workspace. |
| Feedback quality | 76 | 10% | 7.6 | Criterion notes identify matched evidence, missing rubric signals, explicit misconception deductions, and a strong-candidate description. Evidence is described but not quoted from answer spans. |
| Candidate experience | 78 | 10% | 7.8 | Clear scenario/task structure, challenge selection, draft recovery, and deterministic-evaluation disclosure. The 40-character minimum for non-empty answers and unshown deliverables can affect fairness. |
| Recruiter usefulness | 54 | 10% | 5.4 | Role, challenge, report ID, score, criteria, and feedback are visible. The original answer and older report history are not visible in the report/library. |
| Report reliability | 68 | 5% | 3.4 | Saved records and same-profile report links work. Print output was not confirmed, and reports are browser-local rather than public links. |
| Performance and stability | 84 | 5% | 4.2 | Production build completes; output JS is 310.09 kB (95.58 kB gzip). No stress test or full browser-console capture was available. |
| **Overall** |  | **100%** | **74.1/100** | **Meets the internal 70% MVP target.** |

Calculation: `82×0.20 + 68×0.25 + 82×0.15 + 76×0.10 + 78×0.10 + 54×0.10 + 68×0.05 + 84×0.05 = 74.1`.

## 3. Test results and coverage

### Automated checks

`npm run test:evaluator` passed. The case-level count below is 83 checks; the suite also performs repeated weight, weighted-total, and criterion-explanation assertions inside the role cases.

| Test group | Count | Result | Details |
|---|---:|---|---|
| Baseline evaluator responses | 8 | PASS | Empty 0; irrelevant 0; weak 23; partial 33; good 63; excellent 100; valid alternative 100; keyword-heavy wrong 8. |
| Cross-role quality cases | 40 | PASS | Ten cases for each of Data Analyst, Software Developer, AI/ML Engineer, and UI/UX Designer. Every response had five criterion notes, weights summing to 100, and a mathematically correct weighted total. |
| Unrelated-response checks | 12 | PASS | One unrelated answer for each challenge scored 0. |
| Challenge/rubric inventory contracts | 12 | PASS | Unique IDs and scenarios, non-empty scenario/context, three tasks, at least three deliverables and skills, valid time/difficulty, matching per-challenge rubric, three task anchors, and strong-candidate description. |
| Persistence/migration checks | 10 | PASS | Current record round-trip, corrupt JSON, invalid shape, unknown challenge ID, incomplete evaluation, role-key migration, display-name migration, multiple records, legacy draft migration, and corrupt draft. |
| Explicit insecure-auth misconception | 1 | PASS | Plaintext-password reasoning is identified in technical-accuracy feedback. |

### Cross-role evaluator scores

Order is **empty, irrelevant, weak, generic, partial, reasonable, strong, excellent, valid alternative, keyword-heavy but incorrect**.

| Role | Scores | Result |
|---|---|---|
| Data Analyst | 0, 0, 23, 0, 33, 58, 77, 100, 76, 21 | PASS — all calibration bands met. |
| Software Developer | 0, 0, 17, 0, 38, 60, 85, 100, 92, 8 | PASS — all calibration bands met. |
| AI/ML Engineer | 0, 0, 17, 0, 35, 61, 79, 93, 77, 14 | PASS — all calibration bands met. |
| UI/UX Designer | 0, 0, 15, 0, 40, 68, 88, 100, 88, 5 | PASS — all calibration bands met. |

The generic cases deliberately contained no challenge-specific evidence and scored 0. The weak cases included a small amount of relevant evidence and fell within 15–23. These are authored examples calibrated against this rubric; they are not a blind benchmark or comparison against human raters.

### Browser workflow checks

The local Vite app was exercised through the in-app browser. **20 browser outcomes passed** (12 individual challenge selections plus 8 workflow/report checks):

- All 12 challenge cards were visible. Selecting each changed the preview title, role, difficulty, duration, and skills consistently.
- Started a Data Analyst challenge and edited the candidate name and response.
- Refreshed during an in-progress assessment; the selected challenge, name, and full draft response were restored.
- Submitted an empty response; results showed 0/100 and all five criteria at 0.
- Refreshed after completion, navigated to My Evidence, and recovered the saved result.
- Generated a report and verified candidate name, role, challenge, date, report ID, overall score, five criteria, and deterministic-evaluation disclosure.
- Copy report URL changed to its success state.
- Opened the copied report ID directly in a new tab in the same browser profile; the saved report loaded.

### Build, lint, and runtime inspection

- `npm run build` — **PASS** (`tsc -b` and Vite production build; 21 modules transformed).
- `npm run test:evaluator` — **PASS** (8 baseline + 40 cross-role cases, plus challenge and persistence checks).
- `npm run lint` — **PASS with 3 warnings**. The remaining warnings are React `set-state-in-effect` notices in `src/App.tsx`; no lint errors were reported.
- TypeScript compilation — **PASS**, as part of the production build.
- No separate test suite or Playwright package is configured. Browser checks used the available CUA browser automation.
- Full browser console-log capture was unavailable; runtime console errors are **NOT TESTED**.

## 4. Challenge-by-challenge findings

All twelve challenge IDs and scenarios are unique. Each has a realistic situation, role-appropriate constraints, three required tasks, at least three expected deliverables, difficulty, estimated time, skills, and a dedicated rubric. All twelve unrelated-response probes scored 0.

| Challenge | Findings |
|---|---|
| Customer retention — `analyst-retention` | Distinct cohort problem with a defined 90-day change, paid-social/discount hypotheses, one-test budget, available fields, and complete-through-yesterday constraint. Strong and appropriately cautious about causal claims. |
| Profit anomaly — `analyst-anomaly` | Revenue/profit divergence, recent cost migration, and delayed returns make this a credible investigation. The task asks for reconciliation, driver decomposition, and a falsifiable next step. |
| Inventory optimization — `analyst-inventory` | Balances fast-moving stockouts, seasonal overstock, supplier lead time, storage, and cash. Good operational analysis scenario; candidates must state assumptions because exact SKU values are intentionally not supplied. |
| API debugging — `developer-api-debug` | Realistic cross-service timeout, missing correlation IDs, duplicate orders, client retry, and provider idempotency support a concrete debugging and recovery plan. |
| Authentication — `developer-auth` | Covers credential stuffing, shared devices, sensitive multi-tenant data, delayed email links, and a no-SMS constraint. Threat and recovery tasks are well scoped. |
| Database performance — `developer-database` | Includes p95 regression, 40-million-row PostgreSQL table, tenant/time predicates, freshness target, replicas, and index storage trade-off. Useful production-operations task. |
| Model overfitting — `ml-overfitting` | Train/validation gap is paired with temporal production decline and concrete post-snapshot aggregates that could leak future data. Good split/leakage challenge. |
| Imbalanced classification — `ml-imbalance` | The 0.4% prevalence, misleading 99.6% trivial accuracy, 250-alert capacity, asymmetric costs, and delayed labels create a realistic decision task. |
| Model degradation — `ml-degradation` | Precision/recall change, new market, simultaneous device-vendor launch, delayed labels, and review capacity support competing drift/calibration/label-delay hypotheses. |
| Checkout conversion — `designer-checkout` | Shipping-fee surprise is separated from a provider error spike; mobile context and legal itemization constraints prevent an oversimplified conversion-only fix. |
| Onboarding friction — `designer-onboarding` | First-session activation, excessive setup before value, solo evaluators versus teams, and deferrable invites support a credible flow experiment. |
| Accessibility/navigation — `designer-accessibility` | Keyboard trap, screen-reader page-change/label issues, WCAG 2.2 AA, nested navigation, dialogs, routing, and limited QA capacity make a focused accessibility task. |

**Challenge limitations:** expected deliverables are present in challenge data but are not shown in the candidate workspace. All twelve challenges appear in one long list rather than being grouped or filtered by role. The cards identify role clearly, and selection was verified, but the list may become cumbersome as the library grows.

## 5. Evaluation engine findings

### Strengths

- The five weights are exactly 15%, 25%, 25%, 20%, and 15%; the computed overall score is the rounded weighted sum of criterion scores.
- Empty answers return exactly 0. All 12 unrelated challenge probes scored 0.
- Task-coverage anchors contribute only to Problem understanding, avoiding duplicate credit for the same evidence in every criterion.
- Evidence patterns must match within one sentence, so a keyword in a separate paragraph cannot substantiate another claim.
- Explicit misconception rules identify selected dangerous claims, including new idempotency keys on every retry, treating a timeout as proof of failure, plaintext password storage, invalid resampling, and immature-label rollout.
- Each criterion returns a reason, evidence list, missing list, and incorrect-claim list; score feedback is deterministic and contains no external AI call.
- The scoring engine is independent of React, and the provider interface does not contain or expose an API key.

### Remaining accuracy risks

- This is deterministic regex/rule evaluation, not semantic understanding. Valid ideas expressed outside enumerated phrasings can be missed; words connected by a single sentence can still be mistaken for a reasoned relationship.
- Only explicitly listed misconceptions receive deductions. Incorrect claims not covered by a rule may remain unpenalized.
- Pattern credit is discrete and can be coarse within a criterion. A missing synonym or a single matched phrase can move a score substantially.
- The tested answers were written to exercise the rubric and cannot establish hiring validity, inter-rater agreement, or performance on adversarial candidate responses.
- Feedback notes describe the matched rule but do not quote the exact response span that triggered it; this weakens auditability for a recruiter.

## 6. Candidate experience findings

- **PASS:** instructions show a scenario, context, three tasks, role, difficulty, skills, and time estimate.
- **PASS:** all challenges can be selected, and the preview follows the selected challenge.
- **PASS:** drafts recover after refresh, matching the UI’s “Saved as you write” message.
- **PASS:** an empty submission is allowed and produces a 0 score rather than a validation dead end.
- **PARTIAL:** non-empty responses under 40 characters are rejected. This prevents very short answers from being assessed, although the rubric itself can score them.
- **PARTIAL:** deliverables are not visible in the workspace, so candidates see requested tasks but not the expected output formats.
- The challenge uses a single free-text response. The candidate can explain reasoning, but structured evidence, references, code/data attachments, and multi-part answer drafts are not supported.

## 7. Recruiter and report findings

- Reports show candidate name, role, challenge, date, report ID, overall and criterion scores, strengths, improvement notes, and an explicit deterministic-evaluation disclosure.
- The candidate’s submitted answer is stored in the record but **is not displayed in the results or report**. This is a **FAIL** against the requested answer-display check and prevents recruiters from reviewing the exact evidence that supports the score. Fixing this requires a visible UI addition, which was outside this no-UI-change audit constraint.
- The report URL is a hash containing a local record ID. It works in the same browser profile where the record is saved. It does not make the report public or portable to another profile/device.
- Records are prepended to a persisted array and multiple valid records survive parsing, but the interface only displays the currently active/latest result. There is no visible list for finding older assessments if the report ID was lost. This is **PARTIAL** for multiple-report accessibility.
- The copy control displayed its success feedback. Actual clipboard contents were not independently read back.
- The print action was attempted, but the browser automation call timed out at the print boundary; a printed page or print preview was not verified. This is **PARTIAL**.

## 8. Bugs discovered and fixes implemented

| Finding | Fix or disposition |
|---|---|
| Empty answer could not be submitted from the UI even though the evaluator defines empty as 0. | Allowed a blank response through to the evaluator; browser test confirmed a 0/100 result. |
| Workspace said “Saved as you write” but draft state was in React memory only. | Added typed local draft parsing/writing and restored challenge, candidate, and answer at startup; browser refresh test passed. |
| Stored records were accepted with only shallow object checks and unknown challenge IDs could silently fall back to the first challenge. | Added strict record/evaluation normalization, recognized legacy role IDs/display names, rejected unknown challenge IDs, and safely ignored corrupt JSON. |
| Initial record persistence could rewrite normalized records during app mount, including StrictMode development effect replay. | Removed mount-time rewriting; records are persisted when a completed assessment is submitted. Corrupt data is not overwritten just by opening the app. |
| Regex strings used `\.` and `\s` without JavaScript string escaping, so the intended literal patterns were not passed to `RegExp`. | Corrected the escape sequences; lint no longer reports those warnings. |
| The evaluator could earn multiple criteria from task anchors and could join evidence across sentences. | Task anchors now score only understanding; evidence matching is sentence-bounded. |
| ML degradation patterns were too narrow for common language, while a keyword list could appear to describe a reasonable analysis. | Added relation-sensitive evidence patterns for feature quality, slice comparisons, delayed labels, and controlled mitigation; added deductions for ignoring material precision loss or deploying on immature labels. |
| API retry rubric under-recognized a valid asynchronous payment-intent/webhook design and did not strongly penalize contradictory retry/timeout claims. | Added valid worker/webhook reconciliation patterns and explicit misconception deductions; the valid alternative scored 92 in role calibration and the incorrect answer scored 8. |
| Onboarding rubric missed common “project before invite,” “preview first,” and first-project metric language. | Expanded relational patterns and tested a valid preview-first alternative at 88. |
| Candidate answer missing from report and no visible history list for older records. | Documented as **FAIL/PARTIAL**; not changed because rendering these items would alter the approved UI. |

## 9. Test status roll-up

| Status | Count | What it means |
|---|---:|---|
| PASS | 103 | 83 automated case-level checks plus 20 browser outcomes (12 individual challenge previews and 8 workflow/report checks). |
| FAIL | 1 | Candidate answer is absent from generated report/results. |
| PARTIAL | 3 | Older assessments have no visible picker; print preview/output was not confirmed; migration of an unknown pre-role legacy schema could not be established. |
| NOT TESTED | 5 | Full console-log capture; physical/print-to-PDF output; another browser profile/device; mobile responsive and formal accessibility audit; storage quota/disabled-storage behavior. |

The PASS total counts challenge selections individually and challenge contract checks once per challenge; it is a task-level tally, not the number of Node `assert` statements.

## 10. Remaining limitations and production readiness

- Deterministic text patterns cannot reliably understand novel wording or validate domain truth broadly. Keep the “not AI” disclosure; do not use these scores as an employment decision by themselves.
- LocalStorage reports are private to the browser profile and can be removed with site data. There is no server identity, cross-device sync, public hosting, or access control for recruiters.
- Reports omit the original answer and old report discovery is weak.
- Print output, mobile layout, storage quota failures, and a full accessibility review still need direct testing.
- `npm run lint` exits successfully but reports three `react/set-state-in-effect` warnings in `src/App.tsx`.
- The current browser automation could not provide a complete runtime-console log, so this audit does not claim a clean console.

## 11. Top five improvements before the hackathon

1. **Make recruiter evidence auditable:** display the submitted answer in the report and connect each deduction to the answer text that triggered it.
2. **Make saved work discoverable:** add a completed-assessment history selector and test opening older reports after new submissions.
3. **Validate rubric quality with humans:** compare a larger blind response set against independent domain reviewers; document disagreements and revise rules from evidence rather than tuning to the current examples.
4. **Close the report and persistence gaps:** verify print-to-PDF, clipboard contents, cross-profile limitations, migration from the actual previous schema, and storage quota/disabled-storage handling.
5. **Run a product-level usability and accessibility pass:** make expected deliverables visible, assess the twelve-card selection list at mobile sizes, and run keyboard/screen-reader and automated accessibility checks.

## 12. Files changed

- `src/App.tsx` — empty submission flow, draft recovery, safe record persistence, malformed report hash handling.
- `src/data/rubrics.ts` — scoring evidence rules, misconception detection, valid-alternative phrasing, and regex escaping.
- `src/lib/persistence.ts` — new typed localStorage record/draft normalization and legacy migration helpers.
- `tests/evaluation.test.ts` — 40 cross-role evaluator cases, rubric/challenge contracts, persistence/migration checks, and an insecure-auth feedback case.
- `PROOFPILOT_QA_REPORT.md` — this audit report.

`src/App.css` and `src/index.css` were not modified. No visual redesign or style changes were made.
