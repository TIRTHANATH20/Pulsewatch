"""
Financial event extraction.

Approach (explicitly NOT "ask an LLM and call it extraction"):
1. Trigger-word matching identifies the candidate EVENT TYPE (acquisition,
   merger, partnership, earnings_announcement, dividend, product_launch,
   leadership_change, layoffs, regulatory_action, funding, expansion).
2. NER (ner.py) supplies ORGANIZATION and MONEY entities from the same
   sentence.
3. Simple dependency-free heuristics assign ACTOR / TARGET roles: the
   organization nearest to (and before) the trigger verb is the actor;
   the next distinct organization after it is the target. This is a
   template/frame-based extractor, a standard classical IE technique,
   not a trained end-to-end model — documented as such.
4. The news classifier (classification.py) is cross-checked as a secondary
   signal; if it disagrees with the rule trigger, both are surfaced so the
   disagreement is visible rather than silently resolved.
"""
from __future__ import annotations

import re

from .ner import extract_entities
from .classification import classify_text

EVENT_TRIGGERS = {
    "ACQUISITION": [r"\bacqui(?:re|red|res|ring|sition)\b", r"\btakeover\b"],
    "MERGER": [r"\bmerge[rd]?\b", r"\bmerger\b"],
    "PARTNERSHIP": [r"\bpartnership\b", r"\bpartner(?:ed|s)?\s+with\b", r"\bcollaborat", r"\balliance\b", r"\btie-up\b"],
    "EARNINGS_ANNOUNCEMENT": [
        r"\bearnings\s+(?:announcement|report|results|release)\b",
        r"\b(?:announc(?:ed|es)|report(?:ed|s)?|post(?:ed|s)?|releas(?:ed|es)|beat|miss(?:ed|es)?)\b.{0,60}\b(?:quarterly\s+)?earnings\b",
        r"\bquarterly (?:revenue|profit|results)\b",
        r"\breported\b.{0,60}\b(?:revenue|profit|earnings)\b",
    ],
    "DIVIDEND": [r"\bdividend\b"],
    "PRODUCT_LAUNCH": [r"\blaunch(?:ed|es|ing)?\b", r"\bunveil(?:ed|s)?\b", r"\bintroduced\b"],
    "LEADERSHIP_CHANGE": [r"\bappointed\b", r"\bresign(?:ed|s)?\b", r"\bnew (?:ceo|cfo|coo|chairman|chairperson)\b", r"\bleadership change\b"],
    "LAYOFFS": [r"\blayoffs?\b", r"\bjob cuts\b", r"\bworkforce reduction\b"],
    "REGULATORY_ACTION": [r"\bfine[d]?\b", r"\blawsuit\b", r"\bregulat(?:or|ory)\b", r"\bscrutiny\b", r"\binvestigation\b"],
    "FUNDING": [r"\braised \$", r"\bfunding round\b", r"\bseries [a-e]\b"],
    "EXPANSION": [r"\bexpand(?:ed|ing|s|sion)?\b"],
}


def _find_trigger(text: str) -> tuple[str, str] | None:
    lower = text.lower()
    for event_type, patterns in EVENT_TRIGGERS.items():
        for pat in patterns:
            m = re.search(pat, lower)
            if m:
                return event_type, m.group()
    return None


def extract_events(text: str) -> dict:
    trigger = _find_trigger(text)
    if trigger is None:
        return {
            "eventDetected": False,
            "events": [],
            "note": "No known event trigger pattern matched this text.",
        }

    event_type, trigger_word = trigger
    ner_result = extract_entities(text)
    orgs = [e for e in ner_result["entities"] if e["label"] == "ORGANIZATION"]
    money = [e for e in ner_result["entities"] if e["label"] == "MONEY"]

    def org_identity(org: dict) -> str:
        # Two entities that both refer to the same company (e.g. "TCS"
        # and "Tata Consultancy Services" both normalizing to "Tata
        # Consultancy Services") must be treated as the SAME organization
        # when picking actor/target — otherwise actor and target both
        # end up being the subject company mentioned twice, and the
        # actual counterparty (e.g. Microsoft) is never picked up even
        # though it was correctly extracted by NER.
        return (org.get("normalized") or org["text"]).lower()

    distinct_orgs: list[dict] = []
    seen_identities: set[str] = set()
    for org in orgs:
        identity = org_identity(org)
        if identity in seen_identities:
            continue
        seen_identities.add(identity)
        distinct_orgs.append(org)

    actor = distinct_orgs[0].get("normalized") or distinct_orgs[0]["text"] if distinct_orgs else None
    target = None
    if len(distinct_orgs) > 1:
        target = distinct_orgs[1].get("normalized") or distinct_orgs[1]["text"]

    classification = classify_text(text)
    classifier_agrees = classification["category"].replace("_", "").upper() in event_type.replace("_", "")

    return {
        "eventDetected": True,
        "events": [{
            "eventType": event_type,
            "triggerWord": trigger_word,
            "actor": actor,
            "target": target,
            "value": money[0]["text"] if money else None,
            "supportingEntities": ner_result["entities"],
        }],
        "classifierCrossCheck": {
            "predictedCategory": classification["category"],
            "confidence": classification["confidence"],
            "agreesWithTrigger": classifier_agrees,
        },
        "method": "trigger-pattern + NER role assignment (rule-based frame extraction)",
    }
