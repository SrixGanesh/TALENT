# ============================================================
# TalentSphere AI — Python analysis service
#
# Owns exactly the two stages of the flow that need real NLP libraries
# (spaCy, SBERT), which can't run in-browser:
#
#   Resume text --> [spaCy PhraseMatcher] --> skills found
#                --> [SBERT MiniLM]       --> semantic similarity
#                --> blended 0-100 score, matched/missing skills
#
# Everything before this (upload/text extraction) and after this
# (Groq/Llama explanation + interview questions) stays in the React
# app exactly as it already is — this service only replaces the
# "Skills Extraction" + "Semantic Match" boxes in the flow diagram.
#
# Run:
#   pip install -r requirements.txt
#   python -m spacy download en_core_web_sm   # optional, see skill_extractor.py
#   uvicorn main:app --reload --port 8000
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.skill_extractor import extract_skills, extract_contact_hints, _get_nlp_and_matcher
from services.semantic_matcher import semantic_similarity, semantic_missing_skill_hints, _get_model

app = FastAPI(title="TalentSphere AI — Python Analysis Service", version="1.0.0")

# Dev CORS: Vite's default port. Add your deployed frontend origin too
# once this is hosted somewhere other than localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175",
        "http://localhost:5176", "http://127.0.0.1:5176",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    resume_text: str = Field(..., min_length=1)
    job_description: str = ""
    job_skills: list[str] = Field(default_factory=list)
    # Score blend weights — same idea as resumeAnalyzer.js's 0.45/0.55
    # split, exposed here so the frontend can tune it per job if needed.
    semantic_weight: float = 0.5
    coverage_weight: float = 0.5


class AnalyzeResponse(BaseModel):
    score: int
    semantic_similarity: float
    skill_coverage: float
    resume_skills: list[str]
    matched_skills: list[str]
    missing_skills: list[str]
    contact: dict


@app.on_event("startup")
def preload_models():
    # Force both models to load NOW (spaCy PhraseMatcher + SBERT weights,
    # including the one-time ~90MB SBERT download) instead of lazily on
    # the first real /analyze call. Without this, the first request from
    # the frontend can take much longer than its fetch timeout, causing
    # a silent fallback that looks like the service "isn't working" even
    # though it's just still downloading/loading in the background.
    print("Preloading spaCy matcher...")
    _get_nlp_and_matcher()
    print("Preloading SBERT model (first run downloads ~90MB, please wait)...")
    _get_model()
    print("Models loaded — service ready.")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    # 1. spaCy: what skills does the resume actually contain?
    resume_skills = extract_skills(req.resume_text)
    resume_skills_lower = {s.lower() for s in resume_skills}

    required = req.job_skills or []
    required_lower = [s.lower() for s in required]

    matched = [s for s in required if s.lower() in resume_skills_lower]
    missing_raw = [s for s in required if s.lower() not in resume_skills_lower]

    # Give "missing" a semantic second chance — resume might describe the
    # skill in different words (see semantic_missing_skill_hints docstring).
    missing = semantic_missing_skill_hints(missing_raw, req.resume_text) if missing_raw else []
    # Anything that was "missing" but passed the semantic check counts as
    # matched-by-meaning rather than matched-by-exact-word.
    matched_by_meaning = [s for s in missing_raw if s not in missing]
    matched = matched + matched_by_meaning

    coverage = (len(matched) / len(required)) if required else 0.0

    # 2. SBERT: how semantically close is the whole resume to the JD?
    job_text = " ".join([req.job_description] + required)
    similarity = semantic_similarity(req.resume_text, job_text)

    # 3. Blend, same shape as the JS/Groq scorers so callers can swap freely.
    blended = similarity * req.semantic_weight + coverage * req.coverage_weight
    score = round(max(0.0, min(1.0, blended)) * 100)

    return AnalyzeResponse(
        score=score,
        semantic_similarity=round(similarity, 4),
        skill_coverage=round(coverage, 4),
        resume_skills=resume_skills,
        matched_skills=matched,
        missing_skills=missing,
        contact=extract_contact_hints(req.resume_text),
    )