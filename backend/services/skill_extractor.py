# ============================================================
# spaCy-based skill extraction.
#
# Uses a blank English pipeline (tokenizer only — no need for the full
# en_core_web_sm tagger/parser/NER just to match phrases, which keeps
# this fast and avoids the ~15-40MB model download if you don't need
# NER elsewhere). PhraseMatcher does case-insensitive, multi-word,
# alias-aware matching over the SKILLS taxonomy in skills_data.py —
# this is the direct upgrade over the JS regex version in
# src/lib/resumeAnalyzer.js, which only recognises the exact canonical
# spelling.
#
# If you later want name/organisation NER too (e.g. to double-check
# extractNameGuess from the frontend), swap `spacy.blank("en")` for
# `spacy.load("en_core_web_sm")` — everything else here is unaffected.
# ============================================================

import re
from functools import lru_cache

import spacy
from spacy.matcher import PhraseMatcher

from skills_data import SKILLS


@lru_cache(maxsize=1)
def _get_nlp_and_matcher():
    nlp = spacy.blank("en")
    matcher = PhraseMatcher(nlp.vocab, attr="LOWER")

    # canonical_by_pattern maps every alias's spaCy match_id back to the
    # ONE canonical skill name, so "k8s" and "kubernetes" both resolve
    # to "Kubernetes" in the output.
    canonical_by_label = {}
    for canonical, aliases in SKILLS.items():
        label = canonical  # match_id label = canonical name itself
        patterns = [nlp.make_doc(canonical)] + [nlp.make_doc(a) for a in aliases]
        matcher.add(label, patterns)
        canonical_by_label[label] = canonical

    return nlp, matcher


def extract_skills(text: str) -> list[str]:
    """Returns a sorted list of canonical skill names found in `text`."""
    if not text or not text.strip():
        return []
    nlp, matcher = _get_nlp_and_matcher()
    doc = nlp(text)
    matches = matcher(doc)
    found = {nlp.vocab.strings[match_id] for match_id, start, end in matches}
    return sorted(found)


_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"(\+?\d[\d\s-]{8,14}\d)")


def extract_contact_hints(text: str) -> dict:
    """Mirrors extractContactHints() in resumeAnalyzer.js, server-side,
    so both stacks agree if you ever compare outputs."""
    email_match = _EMAIL_RE.search(text or "")
    phone_match = _PHONE_RE.search(text or "")
    return {
        "email": email_match.group(0) if email_match else None,
        "phone": re.sub(r"\s+", " ", phone_match.group(0)).strip() if phone_match else None,
    }
