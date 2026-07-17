// ============================================================
// Resume Analyzer v2
//
// The old version (`extractSkillsFromResume` in ZoneApp.jsx) did a plain
// `text.toLowerCase().includes(skill)` against a fixed 38-word list. That's
// fine as a demo but has two real problems:
//   1. It can't score *how well* a resume matches a job description overall,
//      only whether a handful of exact words appear.
//   2. Nothing outside MASTER_SKILLS is ever recognised.
//
// This version keeps things dependency-free (no external AI API key
// required to run) but upgrades the matching itself to TF-IDF weighted
// cosine similarity between the resume text and the job description/skills,
// which is what most "resume-job similarity" systems use under the hood
// before anyone reaches for an LLM. If/when you want to plug in a real LLM
// or embeddings API later (OpenAI, Claude, Cohere), only `scoreResumeAgainstJob`
// needs to change — everything upstream (extraction, internal-first flow)
// stays the same.
// ============================================================

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are",
  "was","were","be","been","being","as","at","by","from","that","this","it",
  "will","we","our","i","you","your","have","has","had","not","can","also",
  "into","over","using","use","used","years","year","experience","strong",
  "team","work","working","role","job","company","looking","skills","ability",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+.#\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function termFrequency(tokens) {
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return tf;
}

// cosine similarity between two term-frequency vectors (no IDF corpus
// available at this scale, so this is TF-cosine — still far more meaningful
// than a boolean includes() check, since it accounts for word frequency
// and overlap breadth rather than a handful of magic keywords).
function cosineSimilarity(tfA, tfB) {
  const allTerms = new Set([...tfA.keys(), ...tfB.keys()]);
  let dot = 0, magA = 0, magB = 0;
  for (const term of allTerms) {
    const a = tfA.get(term) || 0;
    const b = tfB.get(term) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// A broader, still-fixed vocabulary for the "matched skill pills" UI —
// this is separate from the overall score, which no longer depends on it.
export const MASTER_SKILLS = [
  "Go","Kubernetes","Docker","gRPC","Python","PyTorch","TensorFlow","MLOps","SQL","NoSQL",
  "Tableau","Risk Modeling","Statistics","Figma","Design Systems","User Research","Prototyping",
  "Wireframing","SIEM","Penetration Testing","ISO 27001","Incident Response","Network Security",
  "Firewall Management","React","Vue","Angular","TypeScript","JavaScript","Tailwind","AWS","GCP",
  "Azure","Terraform","Java","Spring","MySQL","PostgreSQL","MongoDB","SEO","Content Strategy",
  "Analytics","Excel","Power BI","Requirements Mapping","Stakeholder Mgmt","Node.js","GraphQL",
  "REST APIs","CI/CD","Git","Agile","Scrum","Machine Learning","Data Engineering","Spark",
];

export function extractSkillsFromResume(text) {
  const lower = (text || "").toLowerCase();
  return MASTER_SKILLS.filter((skill) => {
    // word-boundary match instead of raw substring, so "Go" doesn't match
    // inside "Google" or "going" the way plain includes() used to.
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower);
  });
}

export function extractContactHints(text) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(\+?\d[\d\s-]{8,14}\d)/);
  return {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, " ").trim() : null,
  };
}

// ============================================================
// Bulk-upload auto-profiling — lightweight, dependency-free heuristics
// used to pre-fill name / role / department / experience when HR drops in
// a batch of resumes, so they only have to skim-correct instead of typing
// every field for every file by hand. Client-side only, no LLM/API key
// needed — swap these for a real embeddings/LLM call later if wanted,
// nothing downstream (the internal roster, matching) needs to change.
// ============================================================

// A name is usually the very first non-empty line of a resume, and reads
// like "First Last" (2-4 short words, letters only, no @ / digits / bullets).
// Resumes often also open with a role/title header line (e.g. "MACHINE
// LEARNING ENGINEER") or a section header (e.g. "PROFESSIONAL SUMMARY",
// "CAREER OBJECTIVE") right before or after the actual name — these match
// the same word-count/letters-only shape, so they must be explicitly
// excluded or they get picked up as the "name" by mistake.
const ROLE_WORDS = /\b(engineer|engine|developer|manager|analyst|designer|scientist|specialist|executive|administrator|consultant|director|architect|coordinator|officer|intern|lead|head|founder|writer|recruiter)\b/i;

const SECTION_HEADER_WORDS = /\b(summary|objective|profile|about|contact|education|experience|employment|skills|skill|projects|project|certification|certifications|achievements|achievement|career|details|information|background|overview|expertise|competenc(y|ies)|qualifications|highlights|interests|references|declaration|personal|address)\b/i;

export function extractNameGuess(text, fallback = "") {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const line = lines[i].replace(/^[•\-*]\s*/, "");
    const words = line.split(/\s+/);
    const looksLikeName =
      line.length >= 3 && line.length <= 45 &&
      words.length >= 2 && words.length <= 4 &&
      /^[A-Za-z.'\-\s]+$/.test(line) &&
      !/resume|curriculum|vitae|cv\b/i.test(line) &&
      !ROLE_WORDS.test(line) &&
      !SECTION_HEADER_WORDS.test(line) &&
      !KNOWN_ROLES.some((title) => title.toLowerCase() === line.toLowerCase());
    if (looksLikeName) return line;
  }
  return fallback;
}

// Scans for the first known job-title phrase in the text (case-insensitive).
const KNOWN_ROLES = [
  "Senior Software Engineer","Software Engineer","Staff Engineer","Frontend Developer",
  "Backend Developer","Full Stack Developer","Data Scientist","Data Analyst","Data Engineer",
  "Machine Learning Engineer","AI Engineer","Product Manager","Product Designer","UX Designer",
  "UI Designer","DevOps Engineer","Site Reliability Engineer","QA Engineer","Test Engineer",
  "Marketing Manager","Content Writer","SEO Specialist","Sales Executive","HR Manager",
  "Business Analyst","Project Manager","Security Analyst","Network Engineer",
  "System Administrator","Cloud Engineer","Mobile Developer","iOS Developer","Android Developer",
];
export function extractRoleGuess(text) {
  const lower = (text || "").toLowerCase();
  const hit = KNOWN_ROLES.find((title) => lower.includes(title.toLowerCase()));
  return hit || "";
}

// First "N years" / "N+ yrs" style mention in the text.
export function extractExperienceGuess(text) {
  const match = (text || "").match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs)\b/i);
  return match ? Number(match[1]) : null;
}

// Maps a guessed (or typed) role to one of the fixed department buckets
// used elsewhere in the app, so bulk-imported rows land in a sane default.
export function guessDepartmentFromRole(role) {
  const r = (role || "").toLowerCase();
  if (/design|ux|ui/.test(r)) return "Design";
  if (/data|analyst|scientist|machine learning|\bai\b/.test(r)) return "Data";
  if (/market|seo|content|growth/.test(r)) return "Marketing";
  if (/security|penetration|siem|network/.test(r)) return "Security";
  if (/operations|ops\b|hr\b|admin/.test(r)) return "Operations";
  return "Engineering";
}

// Main scoring function: resume text vs a job's description + required
// skills. Returns 0-100. Blends two signals:
//   - cosine similarity across the full text (captures context/breadth)
//   - explicit required-skill coverage (captures "did they name the
//     specific things this job asked for")
// so a resume can't score high purely by being long and wordy, and can't
// score high purely by keyword-stuffing either.
export function scoreResumeAgainstJob(resumeText, job) {
  const jobText = [job.description, ...(job.skills || [])].filter(Boolean).join(" ");
  const cosine = cosineSimilarity(termFrequency(tokenize(resumeText)), termFrequency(tokenize(jobText)));

  const requiredSkills = (job.skills || []).map((s) => s.toLowerCase());
  const resumeSkills = extractSkillsFromResume(resumeText).map((s) => s.toLowerCase());
  const coverage = requiredSkills.length
    ? requiredSkills.filter((s) => resumeSkills.includes(s)).length / requiredSkills.length
    : 0;

  const blended = cosine * 0.45 + coverage * 0.55;
  return Math.round(Math.min(1, blended) * 100);
}

// Internal-first matching: run every internal employee's resume/skills
// against a newly created job, before it's ever shown to outside candidates.
// Returns employees sorted by score, flagging who clears the job's threshold.
export function matchInternalEmployees(job, employees) {
  return employees
    .map((emp) => {
      const text = [emp.resume_text, ...(emp.skills || [])].filter(Boolean).join(" ");
      const score = scoreResumeAgainstJob(text, job);
      return { ...emp, score, eligible: score >= (job.match_threshold ?? 75) };
    })
    .sort((a, b) => b.score - a.score);
}

// ============================================================
// Candidate-facing job recommender — the inverse direction of
// matchInternalEmployees above. Given one resume and the list of
// currently-open external roles, scores the resume against every job
// with the same scoreResumeAgainstJob() used everywhere else, so the
// number a candidate sees here is the exact same number HR sees on
// their own applicant card once they actually apply — no separate
// "preview" scoring logic to keep in sync.
// ============================================================
export function recommendJobsForResume(resumeText, jobs, { limit = 6, minScore = 0 } = {}) {
  const text = (resumeText || "").trim();
  if (!text) return [];
  return jobs
    .map((job) => ({ job, score: scoreResumeAgainstJob(text, job) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}