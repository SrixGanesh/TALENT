# TalentSphere AI — Python Analysis Service

FastAPI microservice that adds real **spaCy** (skill extraction) and
**SBERT** (semantic resume↔JD matching) to TalentSphere AI, matching
this flow:

```
Resume Upload → Text Extraction → spaCy (skills) → SBERT (semantic match)
             → Final Score → Matched/Missing Skills → Groq/Llama (explanation)
```

The React app already owns "Resume Upload / Text Extraction" and
"Groq/Llama". This service owns the two NLP boxes in between.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
```

No `python -m spacy download` step is required — `main.py` uses
`spacy.blank("en")` (tokenizer only) since PhraseMatcher doesn't need
the trained pipeline. If you later add NER (see the note in
`services/skill_extractor.py`), then run:

```bash
python -m spacy download en_core_web_sm
```

The SBERT model (`all-MiniLM-L6-v2`, ~90MB) downloads automatically
the first time `semantic_matcher.py` runs, and is cached locally after
that (`~/.cache/huggingface`).

## Run

```bash
uvicorn main:app --reload --port 8000
```

Check it's up:

```bash
curl http://localhost:8000/health
```

Then in the React app's `.env`:

```
VITE_PYTHON_API_URL=http://localhost:8000
```

Restart `npm run dev` — the frontend now calls this service first for
scoring, before falling back to Groq, then the built-in TF-IDF scorer.

## API

### `POST /analyze`

Request:
```json
{
  "resume_text": "...",
  "job_description": "...",
  "job_skills": ["React", "Node.js", "AWS"],
  "semantic_weight": 0.5,
  "coverage_weight": 0.5
}
```

Response:
```json
{
  "score": 78,
  "semantic_similarity": 0.61,
  "skill_coverage": 0.83,
  "resume_skills": ["JavaScript", "React", "Node.js", "MongoDB"],
  "matched_skills": ["React", "Node.js"],
  "missing_skills": ["AWS"],
  "contact": {"email": "jane@example.com", "phone": "+1 555 123 4567"}
}
```

## Keeping skills in sync

`skills_data.py` mirrors `src/lib/resumeAnalyzer.js`'s `MASTER_SKILLS`
list, plus aliases (`"k8s"` → `Kubernetes`, `"js"` → `JavaScript`,
etc). If you add a skill to one list, add it to the other — there's no
shared source of truth across the JS/Python boundary by design, since
loading a Node.js file from Python (or vice versa) would add a real
dependency between two otherwise-independent stacks for a 60-line list.

## Deploying

For anything beyond local dev: Docker + any container host that gives
you a persistent process and a couple hundred MB of RAM (the model
lives in memory) — e.g. Render, Railway, Fly.io, or a small VPS.
Serverless (Vercel/Netlify functions) works poorly here because of the
cold-start cost of reloading the SBERT model on every invocation.

A minimal `Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```
