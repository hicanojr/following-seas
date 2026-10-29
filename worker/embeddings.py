"""Embeddings. Local default is sentence-transformers all-MiniLM-L6-v2 (384 dimensions).

An OpenAI-compatible HTTP API is optional. It must return 384-dimension vectors;
a 1536-dimension model will not fit the column.
"""

from __future__ import annotations

import json
import urllib.request
from urllib.parse import urlparse

EMBEDDING_DIM = 384
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_local_model = None


def _check(vectors: list[list[float]], count: int) -> list[list[float]]:
    if len(vectors) != count:
        raise ValueError(f"Embedding count was {len(vectors)} for {count} texts")
    for vector in vectors:
        if len(vector) != EMBEDDING_DIM:
            raise ValueError(f"Expected {EMBEDDING_DIM} dimensions from all-MiniLM, got {len(vector)}")
    return vectors


def _embed_local(texts: list[str], model_name: str) -> list[list[float]]:
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer

        _local_model = SentenceTransformer(model_name)
    matrix = _local_model.encode(texts, normalize_embeddings=True)
    return _check([list(map(float, row)) for row in matrix.tolist()], len(texts))


def _embed_api(texts: list[str], url: str, api_key: str, model_name: str) -> list[list[float]]:
    # urlopen also accepts file:// and other schemes; only send the API key over http(s).
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("EMBEDDING_API_URL must be an http(s) URL")
    payload = json.dumps({"model": model_name, "input": texts}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected -- scheme is checked to be http(s) above
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    data = body.get("data") or []
    ordered = sorted(data, key=lambda item: item.get("index", 0))
    vectors = [[float(value) for value in item["embedding"]] for item in ordered]
    return _check(vectors, len(texts))


def embed_texts(texts: list[str], provider: str, model_name: str, api_url: str | None, api_key: str | None) -> list[list[float]]:
    if not texts:
        return []
    if provider == "api":
        if not api_url or not api_key:
            raise ValueError("EMBEDDING_API_URL and EMBEDDING_API_KEY are required when EMBEDDING_PROVIDER=api")
        return _embed_api(texts, api_url, api_key, model_name)
    return _embed_local(texts, model_name)
