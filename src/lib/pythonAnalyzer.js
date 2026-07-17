// ============================================================
// Client for the Python analysis service (backend/) — real spaCy
// skill extraction + SBERT semantic matching, replacing the in-browser
// TF-cosine approximation in resumeAnalyzer.js when available.
//
// Same fail-safe contract as aiClient.js: returns `null` if no URL is
// configured, the service is unreachable, or the request errors/times
// out — every call site already has a fallback (Groq scoring, then the
// dependency-free JS TF-IDF scorer), so nothing breaks if this service
// isn't running.
//
// Setup: run backend/ (see backend/README.md) and set
//   VITE_PYTHON_API_URL=http://localhost:8000
// in .env.
// ============================================================

const TIMEOUT_MS = 15000;

function baseUrl() {
  return (import.meta.env.VITE_PYTHON_API_URL || "").trim().replace(/\/$/, "");
}

export function isPythonBackendConfigured() {
  return Boolean(baseUrl());
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------
// Resume vs job scoring via spaCy (skills) + SBERT (semantic match).
// Same rough shape as analyzeResumeWithAI() in aiClient.js and
// scoreResumeAgainstJob() in resumeAnalyzer.js, so callers can chain
// all three as a priority list without touching UI code:
//   pythonAnalyzer -> aiClient (Groq) -> resumeAnalyzer (TF-IDF)
// ------------------------------------------------------------------
export async function analyzeResumeWithPython(resumeText, job) {
  if (!isPythonBackendConfigured() || !resumeText?.trim()) return null;

  try {
    const res = await fetchWithTimeout(`${baseUrl()}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resume_text: resumeText,
        job_description: job.description || "",
        job_skills: job.skills || [],
      }),
    });
    if (!res.ok) {
      console.error("Python analysis service error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    if (typeof data.score !== "number") return null;

    return {
      score: Math.max(0, Math.min(100, Math.round(data.score))),
      matchedSkills: Array.isArray(data.matched_skills) ? data.matched_skills : [],
      missingSkills: Array.isArray(data.missing_skills) ? data.missing_skills : [],
      resumeSkills: Array.isArray(data.resume_skills) ? data.resume_skills : [],
      semanticSimilarity: data.semantic_similarity ?? null,
      skillCoverage: data.skill_coverage ?? null,
      contact: data.contact ?? null,
      source: "python-nlp", // spacy + sbert, as opposed to "ai" (Groq) or the TF-IDF default
    };
  } catch (e) {
    console.error("Python analysis service call failed", e);
    return null;
  }
}