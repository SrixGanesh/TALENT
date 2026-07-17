// ============================================================
// AI layer — resume analysis + HR accept/reject notification copy.
//
// Provider: Groq (https://groq.com) — chosen as the "best free API" for
// this project because:
//   - genuinely free tier, no credit card required to get a key
//   - very fast inference (LPU hardware — matters here since this runs
//     synchronously inside a UI click, not a background job)
//   - OpenAI-compatible /chat/completions schema, so no special SDK
//   - serves large, well-instructed open models (Llama 3.3 70B) that are
//     strong enough for structured JSON scoring + formal email drafting
//
// Model: llama-3.3-70b-versatile by default (override with
// VITE_GROQ_MODEL, e.g. to a smaller/faster llama-3.1-8b-instant if you
// want lower latency over accuracy).
//
// Everything here degrades to `null` if no key is configured or a call
// fails — every call site (resumeAnalyzer.js's TF-IDF scorer, and the
// buildHiredMessage/buildRejectionMessage templates in ZoneApp.jsx) has a
// deterministic non-AI fallback, so the app works with zero setup and
// gets smarter the moment a free key is dropped into .env.
//
// Setup: create a free key at https://console.groq.com/keys and set
//   VITE_GROQ_API_KEY=gsk_...
// in your .env (see .env.example).
// ============================================================

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

function apiKey() {
  return (import.meta.env.VITE_GROQ_API_KEY || "").trim();
}

function modelName() {
  return import.meta.env.VITE_GROQ_MODEL || DEFAULT_MODEL;
}

export function isAIEnabled() {
  return Boolean(apiKey());
}

async function chat(messages, { json = false, temperature = 0.4, maxTokens = 600 } = {}) {
  if (!isAIEnabled()) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        model: modelName(),
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      console.error("Groq API error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("Groq API call failed", e);
    return null;
  }
}

// ------------------------------------------------------------------
// Resume vs job scoring. Same 0-100 scale and same rough shape
// ({score, matchedSkills}) as resumeAnalyzer's scoreResumeAgainstJob, so
// callers can swap between them (or fall back) without touching UI code.
// Returns null on any failure/no-key so callers always have a fallback.
// ------------------------------------------------------------------
export async function analyzeResumeWithAI(resumeText, job) {
  if (!isAIEnabled() || !resumeText?.trim()) return null;

  const prompt = `You are a strict, fair technical recruiter. Score how well the RESUME matches the JOB on a 0-100 scale, weighing both explicit required-skill overlap and the overall relevance/depth of the candidate's experience. Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"score": <0-100 integer>, "matchedSkills": [<strings from the required skill list the resume demonstrates>], "missingSkills": [<strings from the required skill list the resume does NOT demonstrate>], "summary": "<one sentence, under 30 words, plain factual tone>"}

JOB TITLE: ${job.title || ""}
JOB DESCRIPTION: ${(job.description || "").slice(0, 1500)}
REQUIRED SKILLS: ${(job.skills || []).join(", ")}

RESUME TEXT:
${resumeText.slice(0, 4000)}`;

  const content = await chat(
    [
      { role: "system", content: "You are a resume-to-job matching engine. Always reply with strictly valid JSON only — no prose, no markdown code fences." },
      { role: "user", content: prompt },
    ],
    { json: true, temperature: 0.2, maxTokens: 500 }
  );
  if (!content) return null;

  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
    if (typeof parsed.score !== "number" || Number.isNaN(parsed.score)) return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [],
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      source: "ai",
    };
  } catch (e) {
    console.error("Failed to parse AI resume analysis JSON", e);
    return null;
  }
}

// ------------------------------------------------------------------
// Explanation of a match result (from pythonAnalyzer's spaCy+SBERT
// score, or the TF-IDF fallback) — the "Explanation" box in the
// Resume -> spaCy -> SBERT -> Final Score -> Groq/Llama flow. Groq
// doesn't (re)score here; it just narrates a score/matched/missing
// breakdown that already exists, in plain language for a human reader.
// Returns null on any failure/no-key; callers should fall back to a
// simple templated sentence built from matchInfo directly.
// ------------------------------------------------------------------
export async function explainMatchWithAI({ resumeText, job, matchInfo }) {
  if (!isAIEnabled()) return null;

  const matched = (matchInfo?.matchedSkills || []).join(", ") || "none listed";
  const missing = (matchInfo?.missingSkills || []).join(", ") || "none";
  const score = matchInfo?.score ?? "unknown";

  const prompt = `You are explaining an automated resume-to-job match result to an HR reviewer. Be concise (3-5 sentences), factual, plain text (no markdown).

JOB TITLE: ${job.title || ""}
JOB DESCRIPTION: ${(job.description || "").slice(0, 800)}
OVERALL SCORE: ${score}/100
MATCHED SKILLS: ${matched}
MISSING SKILLS: ${missing}

Explain WHY the candidate got this score: call out which matched skills carry the most weight for this role, and whether the missing skills are critical gaps or minor ones. Do not repeat the raw lists verbatim — synthesize them into a readable assessment.`;

  const content = await chat(
    [
      { role: "system", content: "You explain resume-matching results to recruiters. Plain text only, no markdown, no bullet lists." },
      { role: "user", content: prompt },
    ],
    { json: false, temperature: 0.4, maxTokens: 300 }
  );
  return content ? content.trim() : null;
}

// ------------------------------------------------------------------
// Interview questions targeting a candidate's specific skill gaps —
// the "Interview Questions" half of the same flow box. Returns an
// array of question strings, or null on any failure/no-key.
// ------------------------------------------------------------------
export async function generateInterviewQuestions({ job, matchInfo, count = 5 }) {
  if (!isAIEnabled()) return null;

  const matched = (matchInfo?.matchedSkills || []).join(", ") || "none listed";
  const missing = (matchInfo?.missingSkills || []).join(", ") || "none";

  const prompt = `Generate exactly ${count} interview questions for a candidate applying to this role. Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"questions": [<string>, ...]}

JOB TITLE: ${job.title || ""}
JOB DESCRIPTION: ${(job.description || "").slice(0, 800)}
CANDIDATE'S MATCHED SKILLS: ${matched}
CANDIDATE'S MISSING/WEAK SKILLS: ${missing}

Mix question types: a couple should probe depth on the matched skills (verify they're not just resume keywords), a couple should probe the missing/weak skills (gauge how big the gap really is or whether they have adjacent experience), and at most one general role-fit question. Keep each question one sentence.`;

  const content = await chat(
    [
      { role: "system", content: "You write targeted technical interview questions. Always reply with strictly valid JSON only — no prose, no markdown code fences." },
      { role: "user", content: prompt },
    ],
    { json: true, temperature: 0.5, maxTokens: 500 }
  );
  if (!content) return null;

  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
    return Array.isArray(parsed.questions) ? parsed.questions : null;
  } catch (e) {
    console.error("Failed to parse AI interview questions JSON", e);
    return null;
  }
}

// ------------------------------------------------------------------
// HR accept/reject notification copy. `decision` is "shortlist" (hired/
// moved forward) or "reject". Returns a plain-text message body, or null
// on any failure/no-key so the caller falls back to the static
// buildHiredMessage/buildRejectionMessage templates.
// ------------------------------------------------------------------
export async function generateDecisionMessage({ decision, applicant, role, companyName, matchInfo }) {
  if (!isAIEnabled()) return null;

  const isHire = decision === "shortlist";
  const missing = (matchInfo?.missingSkills || []).slice(0, 5).join(", ");
  const matched = (matchInfo?.matchedSkills || []).slice(0, 6).join(", ");

  const prompt = isHire
    ? `Write a warm, professional message from an HR team informing a candidate they have been shortlisted/selected for a role. 120-180 words, plain text (no markdown, no subject line), sign off as "${companyName ? companyName + " Team" : "The Hiring Team"}".
Candidate name: ${applicant.name}
Role: ${role.title}
Company: ${companyName || "the company"}
Skills that stood out on their resume: ${matched || "a strong overall profile"}`
    : `Write a respectful, encouraging rejection message from an HR team to a candidate who did not clear the bar for a role. 120-180 words, plain text (no markdown, no subject line), sign off as "${companyName ? companyName + " Team" : "The Hiring Team"}". Be specific but kind: reference 2-4 concrete skills/areas to build next, drawn from the missing-skills list below, without sounding like a generic form rejection. Close by inviting them to reapply once they've grown in these areas, or to look at other open roles.
Candidate name: ${applicant.name}
Role: ${role.title}
Company: ${companyName || "the company"}
Skills the role needed that their resume didn't show: ${missing || "none in particular — their profile was close overall, just not the top fit this time"}`;

  const content = await chat(
    [
      {
        role: "system",
        content: "You write formal, kind HR candidate-communication messages. Plain text only — never use markdown formatting, headers, or bullet asterisks.",
      },
      { role: "user", content: prompt },
    ],
    { json: false, temperature: 0.6, maxTokens: 400 }
  );
  return content ? content.trim() : null;
}
