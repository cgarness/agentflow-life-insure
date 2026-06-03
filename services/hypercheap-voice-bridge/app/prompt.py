"""Prompt + lead-context helpers — mirrors supabase/functions/_shared/aiTestingPrompt.ts.

Same AgentFlow appointment-setting prompt + mock lead context pattern used by the
OpenAI and Deepgram paths, plus a Hypercheap conversation addendum (short turns,
one question at a time, no AI disclosure unless asked).
"""

from __future__ import annotations

from typing import Any, Dict

# The agent always speaks first with this exact line (no trigger words).
FIXED_GREETING = "Hi, this is Sarah. Can you hear me okay?"

# Conversation guidance layered on top of the operator-supplied base prompt.
HYPERCHEAP_CONVERSATION_ADDENDUM = """\
## Conversation style (voice call)
- This is a life insurance appointment-setting phone conversation.
- Speak naturally, like a real person on a call.
- Keep every turn short. Ask one question at a time. Do not monologue.
- Do not mention being an AI unless you are directly asked.
- Your goal is to confirm interest and set the next step (a short appointment).
- If the prospect objects, acknowledge it briefly and redirect to the next step.
"""

_LEAD_FIELDS = (
    "first_name",
    "last_name",
    "city",
    "state",
    "age",
    "lead_source",
    "product_interest",
    "notes",
    "agency_name",
    "agent_name",
)


def normalize_lead_context(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for key in _LEAD_FIELDS:
        value = raw.get(key)
        out[key] = value.strip() if isinstance(value, str) else ""
    return out


def lead_display_name(lead: Dict[str, str]) -> str:
    parts = [lead.get("first_name", ""), lead.get("last_name", "")]
    parts = [p for p in parts if p]
    return " ".join(parts) if parts else "the prospect"


def format_lead_context_block(lead: Dict[str, str]) -> str:
    lines = []
    name = lead_display_name(lead)
    if name != "the prospect":
        lines.append(f"Name: {name}")
    if lead.get("age"):
        lines.append(f"Age: {lead['age']}")
    city, state = lead.get("city", ""), lead.get("state", "")
    if city or state:
        lines.append("Location: " + ", ".join(p for p in (city, state) if p))
    if lead.get("lead_source"):
        lines.append(f"Lead source: {lead['lead_source']}")
    if lead.get("product_interest"):
        lines.append(f"Product interest: {lead['product_interest']}")
    if lead.get("agency_name"):
        lines.append(f"Agency: {lead['agency_name']}")
    if lead.get("agent_name"):
        lines.append(f"Your name on the call: {lead['agent_name']}")
    if lead.get("notes"):
        lines.append(f"Notes from CRM/agent: {lead['notes']}")
    if not lines:
        return "(No lead details provided — use a friendly generic greeting.)"
    return "\n".join(lines)


def build_agent_prompt(base_prompt: str, lead: Dict[str, str]) -> str:
    block = format_lead_context_block(lead)
    return (
        f"{base_prompt.strip()}\n\n"
        f"{HYPERCHEAP_CONVERSATION_ADDENDUM}\n"
        "---\n\n"
        "## Lead details (use naturally — do not read this list aloud)\n\n"
        f"{block}"
    )
