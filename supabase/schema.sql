
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  size text,              
  website text,
  about text,
  created_at timestamptz default now()
);

-- ---------- HR USERS (one row per HR person, linked to a company) --------
create table if not exists hr_users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  work_email text not null,
  designation text,
  created_at timestamptz default now()
);

-- ---------- CANDIDATES -----------------------------------------------------
create table if not exists candidates (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  resume_text text,
  resume_file_name text,
  skills text[] default '{}',
  experience_years numeric,
  created_at timestamptz default now()
);

-- ---------- INTERNAL EMPLOYEES (per company, uploaded by HR) -------------
-- This powers the "check internal team before going external" flow.
create table if not exists internal_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  added_by_hr uuid references hr_users(id) on delete set null,
  name text not null,
  "current_role" text,
  department text,
  skills text[] default '{}',
  resume_text text,
  experience_years numeric,
  created_at timestamptz default now()
);

-- ---------- JOBS ------------------------------------------------------------
-- status drives the internal-first -> external workflow:
--   'internal_review'  -> HR is still checking internal_employees for a fit
--   'external_open'     -> no internal fit found, open on our own portal
--   'pushed_external'    -> also pushed out to LinkedIn/Naukri-style boards
--   'closed'
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  hr_id uuid not null references hr_users(id) on delete cascade,
  title text not null,
  department text,
  location text,
  min_experience numeric default 0,
  match_threshold int default 75,
  skills text[] default '{}',
  description text,
  status text not null default 'internal_review'
    check (status in ('internal_review','external_open','pushed_external','closed')),
  external_boards text[] default '{}',  -- e.g. {'linkedin','naukri'} once pushed
  created_at timestamptz default now()
);

-- ---------- APPLICATIONS ----------------------------------------------------
-- This is the row that makes "HR1's job -> HR1's dashboard" work:
-- every application carries job_id, and job_id -> hr_id is a simple join.
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  hr_id uuid not null references hr_users(id) on delete cascade,
  resume_text text,
  match_score numeric,
  status text not null default 'submitted'
    check (status in ('submitted','reviewed','shortlisted','rejected','hired')),
  source text default 'internal_portal' check (source in ('internal_portal','linkedin','naukri','referral')),
  created_at timestamptz default now(),
  unique (job_id, candidate_id)
);

-- ---------- NOTIFICATIONS ---------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  type text not null check (type in ('hired','rejected','shortlisted','info')),
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists idx_jobs_hr on jobs(hr_id);
create index if not exists idx_jobs_company on jobs(company_id);
create index if not exists idx_applications_hr on applications(hr_id);
create index if not exists idx_applications_job on applications(job_id);
create index if not exists idx_internal_employees_company on internal_employees(company_id);
create index if not exists idx_notifications_candidate on notifications(candidate_id);

-- ============================================================
-- ROW LEVEL SECURITY — this is what actually enforces
-- "HR1 only ever sees HR1's jobs/applicants, HR2 only HR2's".
-- ============================================================
alter table companies enable row level security;
alter table hr_users enable row level security;
alter table candidates enable row level security;
alter table internal_employees enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table notifications enable row level security;

-- Candidates: can read/update only their own profile
create policy candidate_self on candidates
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- HR: can read/update only their own profile row
create policy hr_self on hr_users
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Companies: any authenticated user can read (job board needs to show
-- company name on every listing); any authenticated user can create one
-- (used during HR registration); only the owning HR can update.
create policy companies_read on companies
  for select using (auth.role() = 'authenticated');
create policy companies_update on companies
  for update using (id in (select company_id from hr_users where id = auth.uid()));
create policy companies_insert on companies
  for insert with check (auth.role() = 'authenticated');

-- Jobs: everyone signed in can see jobs that are open (candidate portal),
-- HR can see/manage only jobs under their own company.
create policy jobs_public_read on jobs
  for select using (status in ('external_open','pushed_external') or hr_id = auth.uid());
create policy jobs_hr_write on jobs
  for insert with check (hr_id = auth.uid());
create policy jobs_hr_update on jobs
  for update using (hr_id = auth.uid());

-- Internal employees: visible only to HR of the same company.
create policy internal_employees_hr on internal_employees
  for all using (company_id in (select company_id from hr_users where id = auth.uid()))
  with check (company_id in (select company_id from hr_users where id = auth.uid()));

-- Applications: candidate sees only their own; HR sees only applications
-- for jobs that belong to them (this is the HR1-vs-HR2 routing rule).
create policy applications_candidate_read on applications
  for select using (candidate_id = auth.uid());
create policy applications_candidate_insert on applications
  for insert with check (candidate_id = auth.uid());
create policy applications_hr_read on applications
  for select using (hr_id = auth.uid());
create policy applications_hr_update on applications
  for update using (hr_id = auth.uid());

-- Notifications: candidate reads/marks-read only their own; an HR user can
-- only insert a notification tied to an application they themselves own
-- (same hr_id-routing rule as applications above stops HR1 from writing
-- into HR2's candidate's inbox).
create policy notifications_candidate_read on notifications
  for select using (candidate_id = auth.uid());
create policy notifications_candidate_update on notifications
  for update using (candidate_id = auth.uid());
create policy notifications_hr_insert on notifications
  for insert with check (
    application_id in (select id from applications where hr_id = auth.uid())
  );
