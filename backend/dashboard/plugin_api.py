"""Provider quota backend for the BetterLife desktop plugin.

Mounted at ``/api/plugins/statusline-workspaces/`` by Hermes. Responses contain
usage percentages and reset times only; credentials and account identities are
never returned to the renderer.
"""
from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

import httpx
from fastapi import APIRouter

from agent.account_usage import fetch_account_usage
from agent.credential_pool import load_pool

router = APIRouter()

_CACHE_TTL_SECONDS = 120
_CACHE_LOCK = threading.Lock()
_CACHE_AT = 0.0
_CACHE_VALUE: Optional[Dict[str, Any]] = None
_GROK_BILLING_CREDITS = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
_GROK_BILLING_MONTHLY = "https://cli-chat-proxy.grok.com/v1/billing"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bounded_percent(value: Any) -> Optional[float]:
    number = _number(value)
    if number is None or number < 0 or number > 100:
        return None
    return number


def _amount(value: Any) -> Optional[float]:
    if not isinstance(value, dict):
        return None
    number = _number(value.get("val"))
    return number if number is not None and number >= 0 else None


def _window(label: str, used_percent: float, reset_at: Any = None, detail: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "label": label,
        "used_percent": round(max(0.0, min(100.0, used_percent)), 2),
        "reset_at": _iso(reset_at),
    }
    if detail:
        payload["detail"] = detail
    return payload


def _codex_usage() -> Dict[str, Any]:
    snapshot = fetch_account_usage("openai-codex")
    if snapshot is None:
        return {
            "id": "codex",
            "label": "Codex",
            "available": False,
            "reason": "Codex quota unavailable",
            "windows": [],
        }
    windows = [
        _window(item.label, float(item.used_percent), item.reset_at, item.detail)
        for item in snapshot.windows
    ]
    return {
        "id": "codex",
        "label": "Codex",
        "available": bool(windows),
        "plan": snapshot.plan,
        "source": snapshot.source,
        "windows": windows,
        "details": list(snapshot.details),
    }


def _select_grok_token() -> Optional[str]:
    pool = load_pool("xai-oauth")
    selected = pool.select()
    candidates: Iterable[Any] = [selected] if selected is not None else pool.entries()
    for entry in candidates:
        token = str(getattr(entry, "runtime_api_key", "") or "").strip()
        if token:
            return token
    return None


def _request_grok_payload(client: httpx.Client, url: str, token: str) -> Optional[Dict[str, Any]]:
    response = client.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "X-XAI-Token-Auth": "xai-grok-cli",
        },
        follow_redirects=False,
    )
    if response.status_code != 200:
        return None
    payload = response.json()
    return payload if isinstance(payload, dict) else None


def _parse_grok_payloads(
    credits_payload: Optional[Dict[str, Any]],
    monthly_payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    windows = []
    details = []
    credits = credits_payload.get("config") if isinstance(credits_payload, dict) else None
    credits = credits if isinstance(credits, dict) else {}
    monthly = monthly_payload.get("config") if isinstance(monthly_payload, dict) else None
    monthly = monthly if isinstance(monthly, dict) else {}

    weekly_percent = _bounded_percent(credits.get("creditUsagePercent"))
    period = credits.get("currentPeriod") if isinstance(credits.get("currentPeriod"), dict) else {}
    if weekly_percent is not None:
        windows.append(_window("Weekly credits", weekly_percent, period.get("end")))

    products = credits.get("productUsage")
    if isinstance(products, list):
        for item in products:
            if not isinstance(item, dict):
                continue
            product = str(item.get("product") or "").strip()
            used = _bounded_percent(item.get("usagePercent"))
            if product and used is not None:
                label = "Grok Build" if product == "GrokBuild" else product
                details.append(f"{label}: {used:.0f}% used")

    limit = _amount(monthly.get("monthlyLimit"))
    used = _amount(monthly.get("used"))
    if limit is not None and limit > 0 and used is not None:
        used_percent = min(100.0, used / limit * 100.0)
        windows.append(
            _window(
                "Monthly included",
                used_percent,
                monthly.get("billingPeriodEnd"),
                f"{used:g} / {limit:g} quota points",
            )
        )

    return {
        "id": "grok",
        "label": "Grok",
        "available": bool(windows),
        "source": "cli-chat-proxy.grok.com/v1/billing",
        "windows": windows,
        "details": details,
        "reason": None if windows else "Grok quota unavailable",
    }


def _grok_usage() -> Dict[str, Any]:
    token = _select_grok_token()
    if not token:
        return {
            "id": "grok",
            "label": "Grok",
            "available": False,
            "reason": "Grok OAuth is not configured",
            "windows": [],
        }
    try:
        with httpx.Client(timeout=15.0) as client:
            credits = _request_grok_payload(client, _GROK_BILLING_CREDITS, token)
            monthly = _request_grok_payload(client, _GROK_BILLING_MONTHLY, token)
        return _parse_grok_payloads(credits, monthly)
    except Exception:
        return {
            "id": "grok",
            "label": "Grok",
            "available": False,
            "reason": "Grok billing endpoint unavailable",
            "windows": [],
        }


def provider_usage_snapshot(force: bool = False) -> Dict[str, Any]:
    global _CACHE_AT, _CACHE_VALUE
    now = time.monotonic()
    with _CACHE_LOCK:
        if not force and _CACHE_VALUE is not None and now - _CACHE_AT < _CACHE_TTL_SECONDS:
            return _CACHE_VALUE
        snapshot = {
            "providers": [_codex_usage(), _grok_usage()],
            "fetched_at": datetime.now().astimezone().isoformat(),
        }
        _CACHE_VALUE = snapshot
        _CACHE_AT = now
        return snapshot


@router.get("/usage")
async def provider_usage() -> Dict[str, Any]:
    return await asyncio.to_thread(provider_usage_snapshot)
