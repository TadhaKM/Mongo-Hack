"""Thin Gemini wrapper: async structured output with timeout, retry and model fallback.

Uses google-genai (>=2.28,<3) generate_content with response_json_schema. Errors never propagate to
the pipeline as crashes: callers get LLMUnavailable and fall back to deterministic templates.
"""
from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from rentcheck_agents.config import get_settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_UNSUPPORTED = {"default", "examples", "const", "discriminator"}


class LLMUnavailable(RuntimeError):
    pass


def clean_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Inline $refs and strip keywords Gemini's JSON-schema subset does not accept."""
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                target = defs[node["$ref"].split("/")[-1]]
                merged = {**copy.deepcopy(target), **{k: v for k, v in node.items() if k != "$ref"}}
                return walk(merged)
            return {k: walk(v) for k, v in node.items() if k not in _UNSUPPORTED}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(raw)


_client = None


def _get_client():
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise LLMUnavailable("GEMINI_API_KEY is not set")
        from google import genai
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def llm_available() -> bool:
    return bool(get_settings().gemini_api_key)


async def generate_structured(output_model: type[T], system: str, prompt: str, temperature: float = 0.2) -> tuple[T, str]:
    """Return (parsed output, model id used). Raises LLMUnavailable after primary + fallback fail."""
    from google.genai import types

    settings = get_settings()
    client = _get_client()
    schema = clean_schema(output_model)
    errors: list[str] = []
    for model in dict.fromkeys([settings.gemini_model, settings.gemini_fallback_model]):
        for attempt in range(2):
            try:
                config = types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=temperature,
                    response_mime_type="application/json",
                    response_json_schema=schema,
                    thinking_config=types.ThinkingConfig(thinking_level="low"),
                )
                resp = await asyncio.wait_for(
                    client.aio.models.generate_content(model=model, contents=prompt, config=config),
                    timeout=settings.llm_timeout_seconds,
                )
                return output_model.model_validate_json(resp.text or ""), model
            except (ValidationError, ValueError) as exc:
                errors.append(f"{model}: invalid output ({str(exc)[:160]})")
            except asyncio.TimeoutError:
                errors.append(f"{model}: timeout")
                break  # don't retry a timeout on the same model; try the fallback
            except Exception as exc:  # API errors (429, 5xx, bad model id, thinking config unsupported...)
                msg = str(exc)
                errors.append(f"{model}: {msg[:200]}")
                if "thinking" in msg.lower():
                    # some models reject thinking_level; retry once without it
                    try:
                        config = types.GenerateContentConfig(system_instruction=system, temperature=temperature,
                                                             response_mime_type="application/json", response_json_schema=schema)
                        resp = await asyncio.wait_for(client.aio.models.generate_content(model=model, contents=prompt, config=config),
                                                      timeout=settings.llm_timeout_seconds)
                        return output_model.model_validate_json(resp.text or ""), model
                    except Exception as exc2:
                        errors.append(f"{model} (no thinking): {str(exc2)[:200]}")
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                break
    log.warning("LLM unavailable: %s", errors)
    raise LLMUnavailable("; ".join(errors))
