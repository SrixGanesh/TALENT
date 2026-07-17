# Migration Guide — Single-company prototype → Multi-tenant TalentSphere AI

This version replaces the old single-company, `localStorage`-backed prototype
with a real multi-tenant job portal on Supabase. Here's what changed and how
to get it running.

## What changed

| Area | Before | Now |
|---|---|---|
| Companies | One hardcoded company ("ZONE Technologies") | Unlimited companies, each with its own HR team |
| Auth | Any name/email/4-char password worked, no real check | Real Supabase Auth accounts, register + login for both roles |
| HR signup | N/A | Collects company name, industry, size, website |
| Jobs | Flat list in one shared key | `jobs` table, tagged with `company_id` + `hr_id` |
| Applications | Flat list, HR saw everything | `applications.hr_id` inherited from the job → each HR only ever sees applicants for jobs *they* posted (enforced by both app logic and Postgres Row Level Security) |
| Storage | Browser `localStorage` (via `window.storage` shim) | Supabase (Postgres + Auth) |
| Resume scoring | `text.includes(skill)` against a fixed list | TF-IDF cosine similarity between resume and job description, blended with explicit skill coverage (`src/lib/resumeAnalyzer.js`) |
| Hiring flow | External applicants shown whenever "AI" decided | Internal-first: HR adds employees → job is scored against them → HR explicitly opens to external candidates → HR can push to external boards |
| External boards | N/A | Stubbed queue for LinkedIn/Naukri (`src/lib/externalBoards.js`) — see the reality-check note in that file before wiring real credentials |

## Setup

1. **Create a Supabase project** at https://supabase.com (free tier is enough to start).
2. **Run the schema.** Open the SQL editor in your Supabase project and run the
   contents of `supabase/schema.sql`. This creates every table (`companies`,
   `hr_users`, `candidates`, `internal_employees`, `jobs`, `applications`) and
   the Row Level Security policies that keep HR1 and HR2 from ever seeing
   each other's applicants.
3. **Turn off email confirmation for now (optional, faster local testing).**
   In Supabase: Authentication → Providers → Email → toggle off "Confirm email".
   Turn it back on before going to real users.
4. **Copy your API keys.** Project Settings → API → copy the Project URL and
   the `anon` public key.
5. **Create `.env`** in the project root (copy `.env.example`) and fill in:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
6. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```

## How the HR1 / HR2 routing actually works

- Every job insert (`createJob` in `src/lib/db.js`) stamps `hr_id: session.id`
  and `company_id: session.companyId`.
- Every application insert (`submitApplication`) copies `hr_id`/`company_id`
  straight off the job the candidate applied to — not off the candidate.
- `listApplicationsForJob` filters by `hr_id = session.id`, and Postgres RLS
  enforces the same rule at the database level, so this isn't just
  "trust the frontend" — a forged request still can't read another HR's rows.

## Internal-first hiring flow

1. HR adds employees to the internal roster (name, role, skills, resume
   text) — this is a one-time-ish setup per company, done from the HR
   dashboard's "Add internal employee" form.
2. HR posts a job. It starts in `internal_review` status and is immediately
   scored against every internal employee (`matchInternalEmployees` /
   `matchScore`).
3. If someone clears the job's match threshold, HR sees "internal candidate
   available" and can leave it there — the job never appears on the
   Candidate Portal.
4. If nobody clears the bar, HR clicks "Open to external candidates" →
   `jobs.status = external_open` → the job now appears in `listOpenJobs()`,
   which is what the Candidate Portal reads from.
5. HR can additionally click "Push to LinkedIn + Naukri" → `jobs.status =
   pushed_external`. Today this only records the push and queues mock
   board IDs — see the next section for why.

## External job boards — what's real vs. stubbed

Neither LinkedIn nor Naukri offers an open "post a job" API you can call
with just an API key:

- **LinkedIn**: job posting requires their Talent/Recruiter System Connect
  **partner program** — a business approval process, not a self-serve API.
- **Naukri**: similar story via their RMS (Recruiter Management System)
  partner API, also gated behind a partner agreement.

`src/lib/externalBoards.js` models the workflow end-to-end (job gets a
`pushed_external` status and a list of target boards) without pretending to
have live integrations. When/if you get partner access to either platform,
swap the `postToBoard()` stub in that file for the real API call — nothing
else in the app needs to change.

## Resume analyser — what's real vs. still simple

`src/lib/resumeAnalyzer.js` replaced plain `includes()` keyword matching with
TF-IDF weighted cosine similarity between resume text and job description,
blended with explicit required-skill coverage. This runs entirely
client-side, no API key needed. It's a meaningfully better signal than the
old version, but it's still not an LLM. If you want LLM/embedding-based
matching later (e.g. calling Claude or an embeddings API to compare resume
and job semantically), only `scoreResumeAgainstJob` needs to change —
everything that calls it (application scoring, internal-employee matching)
stays the same.

## Known gaps / next steps

- PDF resumes still aren't parsed client-side (only `.txt` and `.docx`) —
  candidates with PDFs are asked to paste text. Adding `pdfjs-dist` for
  in-browser PDF text extraction is a reasonable next step.
- "Join an existing company" during HR registration currently works by
  typing the exact same company name — a proper company invite/lookup flow
  (search by name, request to join, first HR approves) would be safer for
  production.
- No admin/company-owner role yet — every HR at a company has equal access
  to that company's jobs and internal roster.
