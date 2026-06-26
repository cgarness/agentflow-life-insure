# Implementation Plan — Expand Deepgram AI Testing LLM Picker

**Label:** FEATURE  
**Status:** IMPLEMENTED — branch `claude/ai-testing-deepgram-llm-picker`  
**Date:** 2026-06-26

## Summary

- 9 managed LLM options (OpenAI ×4, Anthropic ×3, Google ×2)
- Composite `provider:model` ids with legacy raw OpenAI compat
- Bridge sends dynamic `think.provider.type` + model
- NVIDIA deferred; default remains `open_ai:gpt-4o-mini`

## Deploy

- Vercel: Yes · Render `ai-voice-bridge`: Yes · Edge/DB/RLS: No
