# Router Per Conversation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow selecting `router_type` (OpenRouter vs Ollama) per conversation and route Stage 1/2/3 accordingly (no fallback).

**Architecture:** Add a small `backend/router_dispatch.py` layer to dynamically delegate model calls to `backend/openrouter.py` or `backend/ollama.py` based on a per-conversation `router_type` field. Extend `/api/models` to accept `router_type` query param and persist `router_type` with conversation data.

**Tech Stack:** FastAPI, Pydantic, pytest; React/Vite frontend.

---

### Task 1: Add router inference + persistence in storage

**Files:**
- Modify: `backend/storage.py`
- Test: `backend/tests/test_router_per_conversation_storage.py`

**Step 1: Write the failing test**

```python
def test_missing_router_type_is_inferred_from_model_ids(tmp_path):
    # conversation with openrouter-like ids should infer openrouter
    ...
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_router_per_conversation_storage.py -q`  
Expected: FAIL (router_type missing / not inferred)

**Step 3: Minimal implementation**

- Add `router_type` to persisted conversation schema (JSON + DB embedding).
- Add normalization on read:
  - if `router_type` missing:
    - if any `model_id` contains `/` → `openrouter`
    - else → `ollama`
    - if ambiguous → `config.ROUTER_TYPE`

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_router_per_conversation_storage.py -q`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/storage.py backend/tests/test_router_per_conversation_storage.py
git commit -m "feat: persist router_type per conversation"
```

---

### Task 2: Add router dispatch module (backend/router_dispatch.py)

**Files:**
- Create: `backend/router_dispatch.py`
- Test: `backend/tests/test_router_dispatch.py`

**Step 1: Write the failing test**

```python
def test_dispatch_calls_openrouter(monkeypatch):
    # monkeypatch backend.openrouter.query_model and ensure called
    ...
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_router_dispatch.py -q`  
Expected: FAIL (module/function missing)

**Step 3: Minimal implementation**

- Implement:
  - `get_router_module(router_type)`
  - thin wrapper functions: `query_model`, `query_models_parallel`, `query_models_streaming`, `query_models_with_stage_timeout`
  - `build_message_content(router_type, text, images=None)`:
    - OpenRouter delegates to `openrouter.build_message_content`
    - Ollama returns `text` (ignore images)

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_router_dispatch.py -q`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/router_dispatch.py backend/tests/test_router_dispatch.py
git commit -m "feat: add router dispatch layer"
```

---

### Task 3: Make council router-agnostic (use dispatch per request)

**Files:**
- Modify: `backend/council.py`
- Test: `backend/tests/test_council_router_type.py`

**Step 1: Write the failing test**

```python
def test_council_uses_router_type(monkeypatch):
    # monkeypatch dispatch to record router_type used
    ...
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_council_router_type.py -q`  
Expected: FAIL (council ignores router_type)

**Step 3: Minimal implementation**

- Remove module-level router selection in `backend/council.py`
- Change council entrypoints to accept `router_type: str`
- Use `router_dispatch.*` for Stage1/2/3 model calls and for `build_message_content`

**Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_council_router_type.py -q`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/council.py backend/tests/test_council_router_type.py
git commit -m "feat: route council by per-conversation router_type"
```

---

### Task 4: Extend backend API (create conversation + /api/models router_type param)

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_models_router_param.py`
- Test: `backend/tests/test_create_conversation_router_type.py`

**Step 1: Write failing tests**

- Conversation creation accepts and returns `router_type`
- `GET /api/models?router_type=ollama` follows the Ollama path and includes `contextLength` in model entries

**Step 2: Verify RED**

Run:
- `pytest backend/tests/test_create_conversation_router_type.py -q`
- `pytest backend/tests/test_models_router_param.py -q`

Expected: FAIL

**Step 3: Minimal implementation**

- Add `router_type` to create conversation request schema:
  - validate `^(openrouter|ollama)$`
- Persist `router_type` into conversation payload via storage.
- On message streaming:
  - load conversation
  - pass `router_type` into council runner
- Update `/api/models`:
  - accept query param `router_type`
  - cache keyed by router_type
  - ensure Ollama model objects contain `contextLength` (use configured minimum if unknown)

**Step 4: Verify GREEN**

Run: `pytest backend/tests/test_create_conversation_router_type.py backend/tests/test_models_router_param.py -q`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_models_router_param.py backend/tests/test_create_conversation_router_type.py
git commit -m "feat: add router_type to conversations and models API"
```

---

### Task 5: Frontend Router selector + wiring

**Files:**
- Modify: `frontend/src/components/ModelSelector.jsx`
- Modify: `frontend/src/api.js`

**Step 1: Add minimal UI + API changes**

- Add router selector state: `openrouter | ollama`
- Change `api.getModels` signature to accept `{ routerType }` and add query param
- On router change: reload models and clear invalid selection
- On confirm: pass `routerType` to `api.createConversation({ ..., routerType })`
- Persist routerType in “Last Used” localStorage payload

**Step 2: Manual sanity checks**

Run:
- `cd frontend && npm ci`
- `cd frontend && npm run build`

Expected: exit 0

**Step 3: Commit**

```bash
git add frontend/src/components/ModelSelector.jsx frontend/src/api.js
git commit -m "feat: add router selector to model picker"
```

---

### Task 6: Full verification

**Files:**
- Modify: (none expected)

**Step 1: Run backend tests**

Run: `pytest backend/tests -q`  
Expected: PASS

**Step 2: Build frontend**

Run:
- `cd frontend && npm ci`
- `cd frontend && npm run build`

Expected: exit 0

