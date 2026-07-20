
from functools import lru_cache

from sentence_transformers import SentenceTransformer, util

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    return SentenceTransformer(MODEL_NAME)


def _chunk(text: str, max_chars: int = 800) -> list[str]:#Splits long text into smaller chunks.
   # Reason SBERT has a maximum input length.Large resumes cannot be processed all at once.
    paras = [p.strip() for p in (text or "").split("\n") if p.strip()]
    #Splits the text into paragraphs and removes empty lines.
    chunks, current = [], ""
    for p in paras:
        if len(current) + len(p) + 1 > max_chars and current:
            chunks.append(current)
            current = p
        else:
            current = f"{current}\n{p}" if current else p
    if current:
        chunks.append(current)
    return chunks or [text or ""]


def semantic_similarity(resume_text: str, job_text: str) -> float:
    
    if not resume_text.strip() or not job_text.strip():
        return 0.0

    model = _get_model()
    resume_chunks = _chunk(resume_text)

    job_emb = model.encode(job_text, convert_to_tensor=True, normalize_embeddings=True)
    chunk_embs = model.encode(resume_chunks, convert_to_tensor=True, normalize_embeddings=True)

    sims = util.cos_sim(chunk_embs, job_emb).squeeze(-1)  # one sim per chunk
    best = float(sims.max().item())
    return max(0.0, min(1.0, best))


def semantic_missing_skill_hints(missing_skills: list[str], resume_text: str, threshold: float = 0.55) -> list[str]:
    """For skills the phrase-matcher didn't find verbatim, check if the
    resume text is *semantically* close anyway (e.g. resume says
    "orchestrated containerized services at scale" for a job requiring
    "Kubernetes"). Returns the subset of `missing_skills` that are
    genuinely absent even by meaning, not just by exact wording — used
    so the "missing skills" shown to HR/candidate isn't overly harsh
    about phrasing differences.
    """
    if not missing_skills or not resume_text.strip():
        return missing_skills

    model = _get_model()
    resume_chunks = _chunk(resume_text)
    chunk_embs = model.encode(resume_chunks, convert_to_tensor=True, normalize_embeddings=True)
    skill_embs = model.encode(missing_skills, convert_to_tensor=True, normalize_embeddings=True)

    sims = util.cos_sim(skill_embs, chunk_embs)  # [num_skills, num_chunks]
    genuinely_missing = []
    for i, skill in enumerate(missing_skills):
        if float(sims[i].max().item()) < threshold:
            genuinely_missing.append(skill)
    return genuinely_missing
