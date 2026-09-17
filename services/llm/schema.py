# services/llm/schema.py
from __future__ import annotations

from typing import Any, Dict, List

# ---- Public JSON Schemas -----------------------------------------------------

ROLLING_SUMMARY_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["key_points", "notes"],
    "properties": {
        "key_points": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "notes": {"type": "string"},
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["description"],
                "properties": {
                    "owner": {"type": "string"},
                    "description": {"type": "string"},
                    "dueDate": {"type": "string", "format": "date"},
                },
            },
        },
    },
}

FINAL_SUMMARY_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["title", "executiveSummary", "keyPoints", "actionItems"],
    "properties": {
        "title": {"type": "string", "maxLength": 200},
        "executiveSummary": {"type": "string"},
        "keyPoints": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        "actionItems": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["description"],
                "properties": {
                    "owner": {"type": "string"},
                    "description": {"type": "string"},
                    "dueDate": {"type": "string", "format": "date"},
                },
            },
        },
    },
}

# ---- Lightweight validation/repair ------------------------------------------
# We avoid a hard dependency on 'jsonschema' and implement a small validator
# that enforces required fields and coarse types for our known schemas.


def _default_for_prop(prop_schema: Dict[str, Any]) -> Any:
    t = prop_schema.get("type")
    if t == "string":
        return ""
    if t == "array":
        return []
    if t == "object":
        return {}
    return None


def _coerce_value(value: Any, prop_schema: Dict[str, Any]) -> Any:
    t = prop_schema.get("type")

    if t == "string":
        # Coerce non-strings to string conservatively
        return value if isinstance(value, str) else ("" if value is None else str(value))

    if t == "array":
        if not isinstance(value, list):
            return []
        item_schema = prop_schema.get("items", {})
        return [_coerce_value(v, item_schema) for v in value]

    if t == "object":
        if not isinstance(value, dict):
            return {}
        # Shallow object validation: enforce required keys and property types
        props = prop_schema.get("properties", {})
        req = prop_schema.get("required", [])
        out: Dict[str, Any] = {}
        for k, ps in props.items():
            if k in value:
                out[k] = _coerce_value(value[k], ps)
            elif k in req:
                out[k] = _default_for_prop(ps)
        # include extra fields as-is (non-strict)
        for k, v in value.items():
            if k not in out:
                out[k] = v
        return out

    # Fallback: return as-is
    return value


def validate_and_repair(data: Dict[str, Any], schema: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enforce a minimal subset of JSON Schema:
    - root must be an object
    - ensure required properties exist (fill defaults)
    - coerce property types (string/array/object)
    - for arrays of objects/strings, coerce each item
    """
    if schema.get("type") != "object":
        # Our top-level schemas are always objects; if not, return input as-is.
        return data

    if not isinstance(data, dict):
        data = {}

    props = schema.get("properties", {})
    required: List[str] = schema.get("required", [])

    repaired: Dict[str, Any] = {}

    # First pass: coerce known properties
    for key, prop_schema in props.items():
        if key in data:
            repaired[key] = _coerce_value(data[key], prop_schema)
        elif key in required:
            repaired[key] = _default_for_prop(prop_schema)

    # Second pass: carry over extras that we don't know about
    for key, value in data.items():
        if key not in repaired:
            repaired[key] = value

    return repaired
