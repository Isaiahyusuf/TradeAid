# Intelligence Engine

Isolated backend module for token intelligence scoring and analysis.

Phase 1 (Infrastructure Hardening) completed in this directory:
- Structured JSON logging (`logging_config.py`)
- Typed async HTTP client with retries and exponential backoff (`http_client.py`)
- Error classification (`exceptions.py`)
- Pydantic validation schemas (`schemas.py`)
- Typed cache and engine entrypoint (`engine.py`, `cache.py`)
- Pipeline orchestration with logging (`data_pipeline.py`, `listeners.py`)

Integration point: `get_token_intelligence(mint: str)`

Next: Phase 2 will introduce per-API fetchers, stricter response schemas, and non-silent aggregation.
