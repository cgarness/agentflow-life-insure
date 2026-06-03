"""OpenRouter LLM client via the OpenAI-compatible streaming chat completions API.

OpenRouter is the LLM provider (not Baseten). We use the official OpenAI Python
SDK pointed at OPENROUTER_BASE_URL with OpenRouter's ranking headers. Streaming is
used to optimize first-token latency. The model is configurable via OPENROUTER_MODEL
and can be overridden per session.
"""

from __future__ import annotations

from typing import AsyncIterator, Dict, List, Optional

from openai import AsyncOpenAI


class OpenRouterUsage:
    def __init__(self) -> None:
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.from_api: bool = False


class OpenRouterClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        site_url: str,
        app_name: str,
        temperature: float,
        max_tokens: int,
        fallback_model: str = "",
    ) -> None:
        self._model = model
        self._fallback_model = (fallback_model or "").strip()
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers={
                # OpenRouter attribution headers (optional but recommended).
                "HTTP-Referer": site_url,
                "X-Title": app_name,
            },
        )

    @property
    def model(self) -> str:
        return self._model

    async def stream_reply(
        self,
        messages: List[Dict[str, str]],
        usage: Optional[OpenRouterUsage] = None,
    ) -> AsyncIterator[str]:
        """Yield assistant text deltas as they stream in.

        Cancellation: the caller cancels the awaiting task on barge-in; the async
        context manager closes the underlying HTTP stream on exit.
        """
        try:
            stream = await self._open_stream(self._model, messages)
        except Exception as exc:  # noqa: BLE001
            # A stale/removed model slug (OpenRouter "No endpoints found", 404) must
            # not silently kill the whole call — retry once on a known-good fallback.
            if (
                self._fallback_model
                and self._fallback_model != self._model
                and _is_model_unavailable(exc)
            ):
                self._model = self._fallback_model
                stream = await self._open_stream(self._fallback_model, messages)
            else:
                raise
        try:
            async for chunk in stream:
                if chunk.usage and usage is not None:
                    usage.prompt_tokens = chunk.usage.prompt_tokens or usage.prompt_tokens
                    usage.completion_tokens = (
                        chunk.usage.completion_tokens or usage.completion_tokens
                    )
                    usage.from_api = True
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content
        finally:
            await stream.close()

    async def _open_stream(self, model: str, messages: List[Dict[str, str]]):
        return await self._client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )

    async def aclose(self) -> None:
        await self._client.close()


def _is_model_unavailable(exc: Exception) -> bool:
    text = str(exc).lower()
    status = getattr(exc, "status_code", None)
    return (
        status in (400, 404)
        or "no endpoints found" in text
        or "not a valid model" in text
        or "no allowed providers" in text
        or ("404" in text and "model" in text)
    )
