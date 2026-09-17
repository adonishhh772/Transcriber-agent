# services/llm/prompts.py

SYSTEM = (
    "You are an expert meeting analyst. "
    "Write concise, actionable meeting notes. "
    "Always return ONLY a single JSON object that matches the provided schema. "
    "Prefer bullet/point-form phrasing, avoid repetition, and extract concrete actions."
)

ROLLING_TMPL = """Recent transcript (ordered, lightly cleaned):
{window_text}

Schema (respond with JSON matching this):
{schema}

Guidelines:
- 4–8 key points max.
- Keep 'notes' short but coherent (2–4 sentences).
- Extract explicit action items with owners/dates only if spoken or clearly implied.
"""

FINAL_TMPL = """Full transcript (ordered, lightly cleaned):
{full_text}

Schema (respond with JSON matching this):
{schema}

Guidelines:
- Title ≤ 200 characters.
- Executive summary: 4–8 sentences (no fluff).
- 8–15 key points maximum; no duplicates; chronological if possible.
- Include all concrete action items (owner/dueDate when stated).
"""
