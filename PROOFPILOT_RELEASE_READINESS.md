# ProofPilot release readiness

**Review date:** 2026-11-19
**Recommendation:** Ready for a controlled static-host demo after an intentional Git baseline is created; not ready to represent as a verified hiring product.

## Summary

The production build and dependency audit succeeded. The current project is a static Vite application suitable for a free static host such as Netlify. A Netlify build and SPA fallback configuration has been added. No deployment, push, or publication was performed.

The checkout currently reports **zero tracked files** (`git ls-files`); project files appear untracked. They were not staged. Establish and review a Git baseline before any public repository preparation or push.

## Build and tests

- Production build: **PASS** (`npm run build`; TypeScript and Vite completed successfully).
- Dependency audit: **PASS**, zero advisories in the current installed/locked dependency tree at audit time.
- The current Vite build emits a chunk-size advisory for a JavaScript bundle above 500 KB; build still succeeds.
- Test scripts: **12/12 PASS** (`test:evaluator`, `test:benchmark`, `test:regression`, `test:sql-blind-holdout`, `test:sql-workflow`, `test:data-analyst`, `test:mvp-access`, `test:gemini-shadow`, `test:auth`, `test:progress`, `test:database`, and `test:persistence`). The database foundation test is a static contract check, not a live PostgreSQL/RLS test.
- Benchmark calibration remains weak: 9/20 original SQL cases within ±5 reference points (45%), 12/20 within ±10 (60%), mean absolute difference 11.1. Invalid high scores: 0 in the benchmark output. References remain provisional.
- Lint: **PASS with 4 warnings** (one unused parameter in a report-generation test script and three React set-state-in-effect warnings in `src/App.tsx`). No lint errors.
- The manual release smoke checklist is prepared but **not executed** in this sprint.
- No live Supabase or Gemini request was made.

## Repository hygiene and secret audit

- `.env.local` is excluded by `.gitignore`; `.env` and `.env.*` are ignored while `.env.example` remains allowed.
- The existing `.env.example` was found to contain a credential-shaped Gemini value and has been replaced with placeholders only. The value was not used or repeated here. Because it was not tracked in this checkout, no commit-history cleanup was performed. If it was a live credential, the owner should assess rotation separately; no credential was rotated in this sprint.
- A read-only scan of `src`, `tests`, `public`, and `supabase` found no common private-key, Gemini-key, Supabase secret-key, or AWS-key patterns. This pattern scan cannot prove absence of every possible secret.
- Environment variables present in this shell: none of the Supabase or Gemini variables were set. No `.env.local` values were read or printed.
- Only public Supabase URL/publishable-key values may be used in browser `VITE_` variables. Gemini credentials are for the local development server only and must not be configured as client variables or on the static host.

## Dependencies

The full current dependency audit reported zero advisories across 102 dependencies. No dependency upgrades were needed or applied. The installed Vite version requires Node.js `^20.19.0 || >=22.12.0`; use a supported Node release for local/host builds. Dependency advisory status can change over time and should be rechecked before publication.

## Hosting and environment

`netlify.toml` sets `npm run build`, publishes `dist`, and rewrites SPA paths to `/index.html`. For a static demo, configure the public Supabase variables only if the relevant optional auth behavior is being exercised. Do not add Gemini keys to the static host: the Gemini shadow adapter is local Vite development middleware and is absent from static hosting. Guided-assessment SQL runs in browser-side SQL.js. The legacy Vite SQL endpoint must remain development-only.

## README and disclosures

The root README now describes setup, build, assessment flow, environment configuration, hosting, demo status, and known limitations. It states that scores are deterministic/client-side, reports are browser-profile-local, results are not independently verified, and evaluator benchmark labels are provisional. The release smoke checklist is in `PROOFPILOT_RELEASE_SMOKE_TEST.md`.

## Remaining blockers and risks

- There is no tracked Git baseline in this checkout. Review all untracked project files and create the intended baseline before publishing.
- Client-side scores are tamperable and not independently verified; do not use them as the sole basis for hiring decisions.
- Reports are browser-local and do not provide cross-device access or controlled public sharing.
- Evaluator benchmark agreement remains below the intended target (45% within ±5); references are provisional.
- The static-host build has no server-side Gemini evaluation. The local SQL/Gemini middleware is not a production service.
- Supabase credentials were not configured in this shell, and no live Supabase check was performed.
- Large JavaScript chunk warning may affect initial load on slower connections; no UI/code-splitting changes were made in this release-preparation scope.

## Smoke test

Use the manual steps in `PROOFPILOT_RELEASE_SMOKE_TEST.md` against the eventual hosted URL. The checklist is not evidence of successful execution.

## Exact next steps after approval

1. Review the zero-tracked-files checkout and confirm which project files belong in the repository; stage and commit an intentional baseline.
2. If the removed credential-shaped `.env.example` entry was a live key, assess and rotate it through its provider; never restore it to source control.
3. Re-run `npm ci`, `npm audit`, the production build, and relevant regression tests on the reviewed commit.
4. Create a Netlify site connected to the approved GitHub repository and branch, using the checked-in build settings (`npm run build`, `dist`).
5. Add only the public Supabase URL and publishable key if required; do not add Gemini or service-role secrets to this static site.
6. Deploy only after explicit approval, then execute the release smoke checklist against the hosted URL and record actual results.
