# ProofPilot

**ProofPilot turns practical job scenarios into structured skill evidence.** Candidates work through role-oriented tasks, run SQL against real data, explain their reasoning, and receive transparent feedback with a browser-local report.

> **Status:** portfolio demonstration / MVP. Scores are deterministic and client-computed for the guided Data Analyst assessment; the repeat-customer SQL verifier runs only in local Vite development. Results are not independently verified, professionally certified, or validated as a hiring decision. Benchmark reference labels are provisional.

## What works today

- Guest access to the assessment catalog and existing role/challenge flows.
- A guided Data Analyst scenario investigating a retail sales decline.
- A deterministic synthetic CSV dataset, schema and data dictionary.
- A Monaco SQL editor that queries the supplied retail dataset in browser-side SQLite/WebAssembly.
- Independent Problem-Solving and Implementation scores for the guided Data Analyst assessment.
- A separate repeat-customer SQL challenge with real SQLite execution and deterministic verification through a local-only Vite development endpoint.
- Evidence, criterion-level feedback, saved drafts, and browser-profile-local reports.
- Optional Supabase email OTP and account-history integration for configured projects.
- A Gemini shadow evaluator for local experiments; it does not change the official candidate score.

## Architecture

```text
React + TypeScript + Vite
├─ Guided retail assessment → Monaco → SQL.js/WebAssembly worker → deterministic client evaluation
├─ Repeat-customer SQL challenge → local Vite middleware → bounded Python/SQLite subprocess → deterministic evaluation
├─ Drafts and reports → browser LocalStorage
└─ Optional account features → Supabase client + PostgreSQL RPC/RLS migrations
```

The Vite SQL execution and optional Gemini shadow middleware are development-only. They are not installed in Vite preview or the static production build. The guided retail assessment uses browser-side SQL.js and remains separate from that endpoint.

## Technology

- React 19, TypeScript, Vite 8
- Monaco Editor
- SQL.js/WebAssembly and SQLite
- Supabase JavaScript client (optional authentication/account sync)
- Python standard-library SQLite for the local SQL verifier
- Node.js test runner and Oxlint

## Run locally

Requirements: Node.js `^20.19.0` or `>=22.12.0` and npm.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and fill only the values needed for a feature. Guest assessment access does not require credentials. Supabase browser configuration uses a publishable key only. The Gemini key is read by local Vite middleware and must never use a `VITE_` prefix.

```sh
npm run dev
```

Open the localhost URL printed by Vite. You can enter the MVP without OTP authentication.

## Assessment flow

Choose the Data Analytics domain and a currently available assessment. In the guided retail assessment, inspect the schema, use SQL to explore real dataset rows, record observations, interpret patterns, and recommend a measurable business action. Submit to generate the two-score report. The repeat-customer SQL challenge provides a separate schema/sample/query editor and verifier when run through local Vite development.

## Build and checks

```sh
npm run build
npm run lint
npm run test:evaluator
npm run test:data-analyst
npm run test:sql-workflow
```

Additional scripts cover SQL benchmarks and holdouts, persistence, authentication helpers, assessment catalog, and Supabase migration contracts. See `package.json` for the complete list. Benchmark results are development evidence only and are not a claim of real-world evaluator accuracy.

## Environment variables

| Variable | Purpose | Required for guest assessment |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL for browser auth/account features | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public Supabase publishable key | No |
| `GEMINI_API_KEY` | Optional key for the local Vite shadow evaluator | No |
| `GEMINI_MODEL` | Server-side model identifier for that local experiment | No |
| `PROOFPILOT_DISABLE_GEMINI_SHADOW` | Disables the local shadow request when set to `true` | No |

Vite-prefixed values are embedded in browser assets, so never put private keys under a `VITE_` name. Do not commit `.env.local`, a service-role key, or other credentials. Do not configure the Gemini development key on static hosting.

## Hosting and demo

The project has a Netlify SPA build configuration: command `npm run build`, publish directory `dist`, and route fallback to `index.html`. **Demo link: not deployed yet.**

Static hosting can serve the application, including the guided browser-side SQL assessment. The repeat-customer verifier and Gemini shadow path require a separately designed secure backend before they can be used on a public deployment; the local Vite endpoints are intentionally absent from production and preview.

## Current limitations

- Guided scores are deterministic and client-side; browser code and scores are inspectable and modifiable.
- The local repeat-customer evaluator is a development tool, not a public execution service or OS-container sandbox.
- Reports and drafts are saved in the current browser profile. They are not publicly hosted, independently verified, or guaranteed to sync across devices.
- Supabase features require the correct project configuration and compatible migrations. The migrations in `supabase/migrations/` have not been applied or live-verified as part of this repository setup.
- Gemini is optional shadow evaluation only. No Gemini result is the official score.
- Evaluator benchmarks include provisional, manually authored references and remain below the intended calibration target.
- This is a portfolio/MVP demonstration, not validated hiring software.

## Roadmap

- Improve evaluator calibration against independent technical review and unseen cases.
- Move trusted evaluation and repeatable SQL execution to an appropriately isolated server-side service.
- Verify Supabase authentication, RLS, and account persistence against a configured project before relying on them.
- Add browser acceptance coverage and improve report portability with explicit privacy controls.
- Expand role workspaces only after the current Data Analyst experience is verified end to end.

## Screenshots

Screenshots will be added after a browser acceptance walkthrough. No product screenshots are included yet.
