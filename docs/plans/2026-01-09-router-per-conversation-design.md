# Router Per Conversation (OpenRouter vs Ollama) — Design

**Date:** 2026-01-09  
**Status:** Approved (per chat)  

## Goal

Allow choosing the LLM router **per conversation**:

- `openrouter` (cloud)
- `ollama` (local)

Once a conversation is created, all stages (Stage 1/2/3) and streaming for that conversation use the same router. No fallback.

## Non-goals (explicitly out of scope)

- Mixing OpenRouter and Ollama models in the same council/conversation.
- Automatic fallback (e.g., OpenRouter → Ollama on 429/timeout).
- “Hybrid” routing mode (can be added later).

## Current state (baseline)

Today the backend has a global `ROUTER_TYPE` (from `.env`) and `backend/council.py` imports OpenRouter/Ollama router functions at module import time. This makes runtime switching impossible inside one server process.

`GET /api/models` also returns models from the globally selected router only.

## Proposed behavior

### Conversation schema

Conversation gains a new field:

- `router_type`: `"openrouter" | "ollama"`

Defaulting / backward compatibility:

- If `router_type` missing (old conversations), infer it:
  - If any selected model id contains `/` → treat as `openrouter`
  - Else → treat as `ollama`
  - If inference cannot decide (edge case), fall back to current global `config.ROUTER_TYPE`

This ensures old conversations keep working even if the default router changes in `.env`.

### Runtime routing dispatch (recommended approach)

Add a small dispatch layer (no “hybrid”, no provider classes yet):

- `backend/router_dispatch.py` exports:
  - `query_model(router_type, ...)`
  - `query_models_parallel(router_type, ...)`
  - `query_models_streaming(router_type, ...)`
  - `query_models_with_stage_timeout(router_type, ...)`
  - `build_message_content(router_type, text, images=None)`

Implementation:

- If `router_type == "openrouter"`: delegate to `backend/openrouter.py`
- If `router_type == "ollama"`: delegate to `backend/ollama.py`
- For `build_message_content`:
  - OpenRouter uses the existing multimodal packing
  - Ollama ignores images (text only), but does not crash

Then `backend/council.py` becomes router-agnostic and uses the dispatch functions instead of importing router code at module import time.

### Models API

Extend models listing to be router-selectable:

- `GET /api/models?router_type=openrouter|ollama`
  - If param omitted: use global default router (existing behavior).

Caching must become per-router, e.g. cache key includes `router_type`.

For Ollama model entries, ensure `contextLength` exists (even if estimated) so the frontend can pick a Chairman:

- Set `contextLength` to `MIN_CHAIRMAN_CONTEXT` (or a large safe sentinel) when unknown.

### Frontend changes

In the ModelSelector:

- Add a “Router” selector: OpenRouter / Ollama.
- When router changes:
  - re-fetch models with `GET /api/models?router_type=...`
  - clear incompatible selections
- Persist the router selection in “Last Used” localStorage payload.

When creating a conversation, include `router_type` in `POST /api/conversations`.

### Security / secrets

No secrets are introduced. API keys remain configured via Setup Wizard / `.env`.

## Testing strategy

Backend:

- Conversation persistence:
  - Creating a conversation with `router_type` persists it in JSON storage (and DB storage if enabled).
  - Old conversations without `router_type` normalize to inferred router type.
- Council dispatch:
  - When `router_type="ollama"`, council calls Ollama router functions (monkeypatch/mocks).
  - When `router_type="openrouter"`, council calls OpenRouter router functions.
- Models endpoint:
  - `GET /api/models?router_type=ollama` uses the Ollama path and includes `contextLength`.

Frontend:

- Smoke: switch Router, see different model list, create conversation, chat works.

