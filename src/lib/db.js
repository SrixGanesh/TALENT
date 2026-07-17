import { supabase } from "./supabaseClient";

/* ============================================================
 * AUTH — candidate and HR each get a real Supabase Auth account.
 * HR registration additionally creates/attaches a company row.
 * ============================================================ */

export async function registerCandidate({ name, email, phone, password }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const userId = data.user.id;

  const { error: profileError } = await supabase.from("candidates").insert({
    id: userId, name, email, phone: phone || null,
  });
  if (profileError) throw profileError;
  return { id: userId, name, email, role: "candidate" };
}

export async function loginCandidate({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const { data: profile, error: profileError } = await supabase
    .from("candidates").select("*").eq("id", data.user.id).single();
  if (profileError) throw profileError;
  return { ...profile, role: "candidate" };
}

// HR registration collects company details. If the company already exists
// (same name), a second HR at that company should use "join existing company"
// instead of creating a duplicate — kept simple here as create-or-attach.
export async function registerHR({
  name, workEmail, password, designation,
  companyName, companyIndustry, companySize, companyWebsite,
}) {
  const { data, error } = await supabase.auth.signUp({ email: workEmail, password });
  if (error) throw error;
  const userId = data.user.id;

  let { data: existingCompany } = await supabase
    .from("companies").select("id").eq("name", companyName).maybeSingle();

  let companyId = existingCompany?.id;
  if (!companyId) {
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({
        name: companyName, industry: companyIndustry,
        size: companySize, website: companyWebsite,
      })
      .select("id").single();
    if (companyError) throw companyError;
    companyId = newCompany.id;
  }

  const { error: hrError } = await supabase.from("hr_users").insert({
    id: userId, company_id: companyId, name, work_email: workEmail, designation,
  });
  if (hrError) throw hrError;

  return { id: userId, name, email: workEmail, companyId, companyName, role: "hr" };
}

export async function loginHR({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const { data: profile, error: profileError } = await supabase
    .from("hr_users")
    .select("*, companies(name, industry, size, website)")
    .eq("id", data.user.id).single();
  if (profileError) throw profileError;

  return {
    id: profile.id, name: profile.name, email: profile.work_email,
    companyId: profile.company_id, companyName: profile.companies?.name,
    role: "hr",
  };
}

// Saves a candidate's resume to their profile (candidates.resume_text /
// skills / resume_file_name / experience_years already exist in the schema
// but were unused before — this is what powers the "job preference /
// AI recommender" panel, so a candidate uploads once and gets matched
// against every open role instead of re-uploading per application.
export async function updateCandidateResume(session, { resumeText, resumeFileName, skills, experienceYears }) {
  const patch = {};
  if (resumeText !== undefined) patch.resume_text = resumeText;
  if (resumeFileName !== undefined) patch.resume_file_name = resumeFileName;
  if (skills !== undefined) patch.skills = skills;
  if (experienceYears !== undefined && experienceYears !== null && !Number.isNaN(experienceYears)) {
    patch.experience_years = experienceYears;
  }
  const { data, error } = await supabase
    .from("candidates").update(patch).eq("id", session.id).select().single();
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const userId = data.session.user.id;

  const { data: hr } = await supabase.from("hr_users")
    .select("*, companies(name)").eq("id", userId).maybeSingle();
  if (hr) return { id: hr.id, name: hr.name, email: hr.work_email, companyId: hr.company_id, companyName: hr.companies?.name, role: "hr" };

  const { data: candidate } = await supabase.from("candidates")
    .select("*").eq("id", userId).maybeSingle();
  if (candidate) return { ...candidate, role: "candidate" };

  return null;
}

/* ============================================================
 * JOBS — every job is tagged with company_id + hr_id. This is
 * the field that later routes an application back to the right
 * HR dashboard: applications.hr_id = jobs.hr_id at insert time.
 * ============================================================ */

export async function createJob(session, job) {
  const { data, error } = await supabase.from("jobs").insert({
    company_id: session.companyId,
    hr_id: session.id,
    title: job.title,
    department: job.department,
    location: job.location,
    min_experience: job.minExperience,
    match_threshold: job.threshold,
    skills: job.skills,
    description: job.description,
    status: "internal_review", // internal-first, per the hiring workflow
  }).select().single();
  if (error) throw error;
  return data;
}

// Candidate-facing feed: jobs from ALL companies that have cleared
// internal review (i.e. HR has opened them to outside candidates).
export async function listOpenJobs() {
  const { data, error } = await supabase
    .from("jobs")
    .select("*, companies(name)")
    .in("status", ["external_open", "pushed_external"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// HR-facing feed: only this HR's own jobs, any status.
export async function listMyJobs(session) {
  const { data, error } = await supabase
    .from("jobs").select("*").eq("hr_id", session.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function setJobStatus(jobId, status, externalBoards) {
  const patch = { status };
  if (externalBoards) patch.external_boards = externalBoards;
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}

/* ============================================================
 * INTERNAL EMPLOYEES — HR uploads/collects these per company.
 * Used for the internal-first match pass before a job goes external.
 * ============================================================ */

export async function addInternalEmployee(session, employee) {
  const { data, error } = await supabase.from("internal_employees").insert({
    company_id: session.companyId,
    added_by_hr: session.id,
    name: employee.name,
    current_role: employee.role,
    department: employee.department,
    skills: employee.skills,
    resume_text: employee.resumeText,
    experience_years: employee.experienceYears,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function listInternalEmployees(session) {
  const { data, error } = await supabase
    .from("internal_employees").select("*").eq("company_id", session.companyId);
  if (error) throw error;
  return data;
}

/* ============================================================
 * APPLICATIONS — this insert is what makes "apply to HR1's job
 * shows up on HR1's dashboard, HR2's job shows up on HR2's" work:
 * hr_id is copied straight off the job at submit time, so every
 * later query HR runs (listMyJobs -> applications where hr_id=me)
 * only ever returns applicants for jobs *they* posted.
 * ============================================================ */

export async function submitApplication({ job, candidate, resumeText, matchScore }) {
  const { data, error } = await supabase.from("applications").insert({
    job_id: job.id,
    candidate_id: candidate.id,
    company_id: job.company_id,
    hr_id: job.hr_id,
    resume_text: resumeText,
    match_score: matchScore,
    source: "internal_portal",
  }).select().single();
  if (error) throw error;
  return data;
}

// HR dashboard: applicants for a specific job THIS hr owns.
// RLS already blocks cross-HR reads, but we also filter by hr_id
// explicitly so a stale/forged job_id can't leak another HR's rows.
export async function listApplicationsForJob(session, jobId) {
  const { data, error } = await supabase
    .from("applications")
    .select("*, candidates(name, email, phone, skills)")
    .eq("job_id", jobId).eq("hr_id", session.id);
  if (error) throw error;
  return data;
}

export async function updateApplicationStatus(applicationId, status) {
  const { error } = await supabase.from("applications").update({ status }).eq("id", applicationId);
  if (error) throw error;
}

/* ============================================================
 * NOTIFICATIONS — in-app inbox for candidates. HR's shortlist/reject
 * decision writes a row here instead of sending a real email (no email
 * backend is wired up); the candidate reads it inside their own portal.
 * RLS (see schema.sql) only lets an HR insert a notification tied to an
 * application that belongs to them, and only lets a candidate read/mark
 * their own — same hr_id-routing pattern as applications above.
 * ============================================================ */

export async function createNotification({ candidateId, applicationId, jobId, type, title, message }) {
  // NOTE: no .select() here on purpose. The inserting user is HR, and the
  // only SELECT policy on notifications is "candidate_id = auth.uid()" (a
  // candidate reading their own inbox). Supabase's .select() asks Postgres
  // to RETURNING the inserted row, and Postgres RLS requires the inserting
  // role to also satisfy a SELECT policy on that row to hand it back — HR
  // never does, so RETURNING (not the insert itself) was the thing tripping
  // the 42501 "violates row-level security policy" error. Dropping .select()
  // avoids that read-back entirely; callers don't use the returned row.
  const { error } = await supabase.from("notifications").insert({
    candidate_id: candidateId,
    application_id: applicationId,
    job_id: jobId,
    type, title, message,
  });
  if (error) throw error;
}

export async function listNotifications(session) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*, jobs(title)")
    .eq("candidate_id", session.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function markNotificationRead(notificationId) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(session) {
  const { error } = await supabase.from("notifications").update({ read: true })
    .eq("candidate_id", session.id).eq("read", false);
  if (error) throw error;
}