from __future__ import annotations

from app.providers.base import ProviderAdapter

_registry: dict[str, ProviderAdapter] = {}


def register(name: str, adapter: ProviderAdapter) -> None:
    _registry[name] = adapter


def get(name: str) -> ProviderAdapter:
    if name not in _registry:
        raise KeyError(f"unsupported provider: {name}")
    return _registry[name]


def names() -> list[str]:
    return list(_registry)
