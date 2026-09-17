# services/llm/client.py
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

import httpx

from apps.api.settings import settings
from services.llm.schema import validate_and_repair


class LLMClient:
    """
    Provider-agnostic async client with a JSON-oriented call.
    Supports: OpenAI, DeepSeek (OpenAI-compatible). Anthropic left unimplemented here.
    """

    def __init__(self, provider: str, model: str):
        self.provider = provider.lower().strip()
        self.model = model

    async def json_call(
        self,
        system: str,
        user: str,
        schema: Dict[str, Any],
        *,
        temperature: float = 0.0,
        max_retries: int = 3,
        timeout_s: float = 60.0,
    ) -> Dict[str, Any]:
        raw = "{}"
        last_err: Optional[Exception] = None

        for attempt in range(1, max_retries + 1):
            try:
                if self.provider == "openai":
                    raw = await _openai_json_completion(
                        system=system,
                        user=user,
                        model=self.model,
                        api_key=settings.openai_api_key,
                        temperature=temperature,
                        timeout_s=timeout_s,
                    )
                elif self.provider == "deepseek":
                    raw = await _deepseek_json_completion(
                        system=system,
                        user=user,
                        model=self.model,
                        api_key=settings.deepseek_api_key,
                        base_url=settings.deepseek_base_url,
                        temperature=temperature,
                        timeout_s=timeout_s,
                    )
                elif self.provider == "anthropic":
                    raise NotImplementedError("Anthropic not wired yet in this client.")
                else:
                    raise NotImplementedError(f"Unknown LLM provider: {self.provider}")

                data = json.loads(raw)
                return validate_and_repair(data, schema)

            except Exception as e:
                last_err = e
                await asyncio.sleep(0.5 * (2 ** (attempt - 1)))

        # If exhausted retries, return schema-shaped default or bubble error
        try:
            return validate_and_repair({}, schema)
        except Exception:
            raise RuntimeError(f"LLM JSON call failed after {max_retries} attempts: {last_err}") from last_err


async def _openai_json_completion(
    *,
    system: str,
    user: str,
    model: str,
    api_key: Optional[str],
    temperature: float,
    timeout_s: float,
) -> str:
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured")

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)

    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            temperature=temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        ),
        timeout=timeout_s,
    )
    return resp.choices[0].message.content or "{}"


async def _deepseek_json_completion(
    *,
    system: str,
    user: str,
    model: str,
    api_key: Optional[str],
    base_url: str,
    temperature: float,
    timeout_s: float,
) -> str:
    """
    DeepSeek Chat (OpenAI-compatible). Endpoint: {base_url}/chat/completions
    We request JSON output by passing response_format={"type":"json_object"}.
    """
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY is not configured")

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,  # "deepseek-chat"
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        # OpenAI-compatible shape
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content")
        )
        return content or "{}"


def get_llm(_settings=None) -> LLMClient:
    _settings = _settings or settings
    return LLMClient(provider=_settings.llm_provider, model=_settings.llm_model)
