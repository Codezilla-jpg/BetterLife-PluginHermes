"""Backend API for the BetterLife desktop plugin.

Mounted at ``/api/plugins/statusline-workspaces/`` by Hermes. Quota responses
contain usage percentages, reset times and coarse account labels, never tokens
or other credentials.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException

from agent.account_usage import build_nous_credits_snapshot, fetch_account_usage
from agent.credential_pool import load_pool

router = APIRouter()
_LOGGER = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 120
_CACHE_LOCK = threading.Lock()
_CACHE_CONDITION = threading.Condition(_CACHE_LOCK)
_CACHE_AT = 0.0
_CACHE_VALUE: Optional[dict[str, Any]] = None
_CACHE_REFRESHING = False
_GROK_BILLING_CREDITS = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
_GROK_BILLING_MONTHLY = "https://cli-chat-proxy.grok.com/v1/billing"
_GATEWAY_RESTART_COMMAND = (
    "/usr/bin/sudo",
    "-n",
    "/usr/bin/systemctl",
    "restart",
    "hermes-gateway.service",
)
_HERMES_RESTART_HELPER = Path(__file__).with_name("restart_helper.py")


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    number = _number(value)
    if number is not None and number > 1_000_000_000:
        try:
            return datetime.fromtimestamp(number, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    return text or None


def _bounded_percent(value: Any) -> Optional[float]:
    number = _number(value)
    return number if number is not None and 0 <= number <= 100 else None


def _amount(value: Any) -> Optional[float]:
    if not isinstance(value, dict):
        return None
    number = _number(value.get("val"))
    return number if number is not None and number >= 0 else None


def _window(
    key: str,
    label: str,
    used_percent: Any,
    reset_at: Any = None,
    detail: Optional[str] = None,
) -> dict[str, Any]:
    used = _number(used_percent) or 0.0
    payload: dict[str, Any] = {
        "key": key,
        "label": label,
        "used_percent": round(max(0.0, min(100.0, used)), 2),
        "reset_at": _iso(reset_at),
    }
    if detail:
        payload["detail"] = detail
    return payload


def _unavailable(provider_id: str, label: str, reason: str) -> dict[str, Any]:
    return {
        "id": provider_id,
        "label": label,
        "available": False,
        "reason": reason,
        "account": None,
        "plan": None,
        "windows": [],
        "details": [],
    }


def _codex_usage_url(base_url: Optional[str] = None) -> str:
    """ChatGPT backend-api uses /wham/usage; other Codex bases use /api/codex/usage."""
    normalized = (base_url or "").strip().rstrip("/") or "https://chatgpt.com/backend-api/codex"
    normalized = normalized.removesuffix("/codex")
    prefix = normalized + ("/wham" if "/backend-api" in normalized else "/api/codex")
    return prefix + "/usage"


def _codex_credentials() -> tuple[Optional[str], str, Optional[str]]:
    from agent.account_usage import _resolve_codex_usage_credentials

    token, base_url, account_id = _resolve_codex_usage_credentials(None, None)
    return token, _codex_usage_url(base_url), account_id


def _provider_from_snapshot(
    provider_id: str,
    label: str,
    snapshot: Any,
    missing_reason: str,
    *,
    account: Optional[str] = None,
) -> dict[str, Any]:
    if snapshot is None:
        return _unavailable(provider_id, label, missing_reason)
    reason = getattr(snapshot, "unavailable_reason", None)
    if reason:
        result = _unavailable(provider_id, label, str(reason))
        result["plan"] = getattr(snapshot, "plan", None)
        result["account"] = account
        return result
    windows: list[dict[str, Any]] = []
    for item in getattr(snapshot, "windows", ()) or ():
        used = getattr(item, "used_percent", None)
        if used is None:
            continue
        windows.append(
            _window(
                str(getattr(item, "label", "window")).lower().replace(" ", "-"),
                str(getattr(item, "label", "Window")),
                used,
                getattr(item, "reset_at", None),
                getattr(item, "detail", None),
            )
        )
    details = [str(detail) for detail in (getattr(snapshot, "details", ()) or ()) if detail]
    return {
        "id": provider_id,
        "label": label,
        "available": bool(windows),
        "reason": None if windows else missing_reason,
        "account": account,
        "plan": getattr(snapshot, "plan", None),
        "windows": windows,
        "details": details,
    }


def _fetch_codex_payload(
    token: str,
    url: str,
    account_id: Optional[str] = None,
    requester: Any = None,
) -> Optional[dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "codex-cli",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id
    request = requester or httpx.get
    response = request(
        url,
        headers=headers,
        timeout=15.0,
    )
    if response.status_code != 200:
        return None
    payload = response.json()
    return payload if isinstance(payload, dict) else None


def _parse_codex(payload: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _unavailable("codex", "OpenAI Codex", "Codex quota unavailable")

    windows: list[dict[str, Any]] = []
    rate_limit = payload.get("rate_limit")
    rate_limit = rate_limit if isinstance(rate_limit, dict) else {}
    for key, label in (("primary_window", "Session"), ("secondary_window", "Weekly")):
        window = rate_limit.get(key)
        window = window if isinstance(window, dict) else {}
        used = _bounded_percent(window.get("used_percent"))
        if used is not None:
            windows.append(_window(key, label, used, window.get("reset_at")))

    extras = payload.get("additional_rate_limits")
    if isinstance(extras, list):
        for item in extras:
            if not isinstance(item, dict):
                continue
            name = str(item.get("limit_name") or "").strip()
            inner = item.get("rate_limit")
            if not name or not isinstance(inner, dict):
                continue
            short_name = name.removeprefix("GPT-")
            for key, fallback_period in (("primary_window", "5h"), ("secondary_window", "Weekly")):
                window = inner.get(key)
                window = window if isinstance(window, dict) else {}
                used = _bounded_percent(window.get("used_percent"))
                if used is None:
                    continue
                seconds = _number(window.get("limit_window_seconds"))
                period = "Weekly" if seconds == 604_800 else fallback_period
                windows.append(
                    _window(
                        f"model-{period.lower()}-{name}",
                        f"{short_name} · {period}",
                        used,
                        window.get("reset_at"),
                    )
                )

    details: list[str] = []
    reset_credits = payload.get("rate_limit_reset_credits")
    reset_credits = reset_credits if isinstance(reset_credits, dict) else {}
    banked = _number(reset_credits.get("available_count"))
    if banked is not None and banked > 0:
        count = int(banked)
        details.append(f"{count} reset credit{'s' if count != 1 else ''} banked")

    account = str(payload.get("email") or "").strip() or None
    plan = str(payload.get("plan_type") or "").strip()
    return {
        "id": "codex",
        "label": "OpenAI Codex",
        "available": bool(windows),
        "reason": None if windows else "Codex quota unavailable",
        "account": account,
        "plan": plan.title() if plan else None,
        "windows": windows,
        "details": details,
    }


def _codex_usage() -> dict[str, Any]:
    try:
        token, url, account_id = _codex_credentials()
        if token:
            parsed = _parse_codex(_fetch_codex_payload(token, url, account_id))
            if parsed["available"]:
                return parsed
    except Exception:
        _LOGGER.debug("Rich Codex usage failed; using canonical fallback", exc_info=True)

    snapshot = fetch_account_usage("openai-codex")
    return _provider_from_snapshot("codex", "OpenAI Codex", snapshot, "Codex quota unavailable")


def _claude_usage() -> dict[str, Any]:
    try:
        snapshot = fetch_account_usage("anthropic")
    except Exception:
        _LOGGER.debug("Claude usage collection failed", exc_info=True)
        return _unavailable("claude", "Claude", "Claude quota unavailable")
    result = _provider_from_snapshot(
        "claude",
        "Claude",
        snapshot,
        "Claude OAuth is not configured",
    )
    session = next((window for window in result["windows"] if window["key"] == "current-session"), None)
    if session is not None:
        result["display_used_percent"] = session["used_percent"]
        result["display_reset_at"] = session["reset_at"]
    return result


def _select_grok_token() -> Optional[str]:
    pool = load_pool("xai-oauth")
    selected = pool.select()
    candidates = [selected] if selected is not None else pool.entries()
    for entry in candidates:
        token = str(getattr(entry, "runtime_api_key", "") or "").strip()
        if token:
            return token
    return None


def _request_grok_payload(client: httpx.Client, url: str, token: str) -> Optional[dict[str, Any]]:
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


def _parse_grok_payloads(credits_payload: Any, monthly_payload: Any) -> dict[str, Any]:
    windows: list[dict[str, Any]] = []
    credits = credits_payload.get("config") if isinstance(credits_payload, dict) else None
    credits = credits if isinstance(credits, dict) else {}
    monthly = monthly_payload.get("config") if isinstance(monthly_payload, dict) else None
    monthly = monthly if isinstance(monthly, dict) else {}

    weekly_percent = _bounded_percent(credits.get("creditUsagePercent"))
    period = credits.get("currentPeriod")
    period = period if isinstance(period, dict) else {}
    grok_build_percent = None
    products = credits.get("productUsage")
    if isinstance(products, list):
        for item in products:
            if isinstance(item, dict) and item.get("product") == "GrokBuild":
                grok_build_percent = _bounded_percent(item.get("usagePercent"))
                if grok_build_percent is not None:
                    break

    display_percent = grok_build_percent if grok_build_percent is not None else weekly_percent
    if display_percent is not None:
        label = "Grok Build" if grok_build_percent is not None else "Weekly credits"
        windows.append(_window("grok-build", label, display_percent, period.get("end")))

    limit = _amount(monthly.get("monthlyLimit"))
    used = _amount(monthly.get("used"))
    if limit is not None and limit > 0 and used is not None:
        windows.append(
            _window(
                "monthly-included",
                "Monthly included",
                min(100.0, used / limit * 100.0),
                monthly.get("billingPeriodEnd"),
                f"{used:g} / {limit:g} quota points",
            )
        )

    result = _unavailable("grok", "xAI Grok", "Grok quota unavailable")
    result.update(
        available=bool(windows),
        reason=None if windows else result["reason"],
        windows=windows,
        display_used_percent=display_percent,
        display_reset_at=_iso(period.get("end")),
    )
    return result


def _grok_usage() -> dict[str, Any]:
    token = _select_grok_token()
    if not token:
        return _unavailable("grok", "xAI Grok", "Grok OAuth is not configured")
    try:
        with httpx.Client(timeout=15.0) as client:
            credits = _request_grok_payload(client, _GROK_BILLING_CREDITS, token)
            monthly = _request_grok_payload(client, _GROK_BILLING_MONTHLY, token)
        return _parse_grok_payloads(credits, monthly)
    except Exception:
        _LOGGER.debug("Grok usage collection failed", exc_info=True)
        return _unavailable("grok", "xAI Grok", "Grok billing endpoint unavailable")


def _nous_usage() -> dict[str, Any]:
    unavailable = _unavailable("nous", "Nous Research", "Nous Portal unavailable")
    try:
        from hermes_cli.nous_account import get_nous_portal_account_info

        account = get_nous_portal_account_info(force_fresh=True)
    except Exception:
        _LOGGER.debug("Nous usage collection failed", exc_info=True)
        return unavailable

    if account is None or not getattr(account, "logged_in", False):
        unavailable["reason"] = "Nous Portal not logged in"
        return unavailable

    snapshot = build_nous_credits_snapshot(account)
    windows = []
    if snapshot is not None:
        windows = [
            _window(item.label.lower(), item.label, item.used_percent, item.reset_at, item.detail)
            for item in snapshot.windows
        ]
    subscription = getattr(account, "subscription", None)
    plan = getattr(subscription, "plan", None) if subscription is not None else None
    access = getattr(account, "paid_service_access_info", None)
    return {
        "id": "nous",
        "label": "Nous Research",
        "available": bool(windows),
        "reason": None if windows else "Nous quota unavailable",
        "account": getattr(account, "email", None),
        "plan": plan,
        "windows": windows,
        "details": [str(detail) for detail in (snapshot.details if snapshot is not None else [])],
        "total_usable_credits": getattr(access, "total_usable_credits", None) if access else None,
        "paid_access": getattr(account, "paid_service_access", None),
    }


def _collect_provider_usage() -> list[dict[str, Any]]:
    collectors = (_nous_usage, _claude_usage, _codex_usage, _grok_usage)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(collectors)) as executor:
        futures = [executor.submit(collector) for collector in collectors]
        return [future.result() for future in futures]


def provider_usage_snapshot(force: bool = False) -> dict[str, Any]:
    global _CACHE_AT, _CACHE_REFRESHING, _CACHE_VALUE
    now = time.monotonic()
    with _CACHE_CONDITION:
        if not force and _CACHE_VALUE is not None and now - _CACHE_AT < _CACHE_TTL_SECONDS:
            return _CACHE_VALUE
        if _CACHE_REFRESHING:
            _CACHE_CONDITION.wait_for(lambda: not _CACHE_REFRESHING)
            if _CACHE_VALUE is not None:
                return _CACHE_VALUE
        _CACHE_REFRESHING = True

    try:
        snapshot = {
            "providers": _collect_provider_usage(),
            "fetched_at": datetime.now().astimezone().isoformat(),
        }
    except Exception:
        with _CACHE_CONDITION:
            _CACHE_REFRESHING = False
            _CACHE_CONDITION.notify_all()
        raise

    with _CACHE_CONDITION:
        _CACHE_VALUE = snapshot
        _CACHE_AT = time.monotonic()
        _CACHE_REFRESHING = False
        _CACHE_CONDITION.notify_all()
    return snapshot


async def _restart_system_gateway(executor: Any = None) -> dict[str, Any]:
    run = executor or asyncio.create_subprocess_exec
    process = await run(
        *_GATEWAY_RESTART_COMMAND,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    if process.returncode != 0:
        detail = (stderr or stdout or b"gateway restart failed").decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail)
    return {"ok": True, "target": "gateway"}


def _schedule_hermes_restart(pid: Optional[int] = None) -> int:
    target_pid = pid or os.getpid()
    subprocess.Popen(
        [sys.executable, str(_HERMES_RESTART_HELPER), str(target_pid)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    return target_pid


@router.get("/usage")
async def provider_usage(force: bool = False) -> dict[str, Any]:
    return await asyncio.to_thread(provider_usage_snapshot, force)


@router.post("/refresh")
async def provider_refresh() -> dict[str, Any]:
    return await asyncio.to_thread(provider_usage_snapshot, True)


@router.post("/restart/gateway")
async def restart_gateway() -> dict[str, Any]:
    try:
        return await _restart_system_gateway()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gateway restart failed: {exc}") from exc


@router.post("/restart/hermes")
async def restart_hermes() -> dict[str, Any]:
    return {"ok": True, "target": "hermes", "pid": _schedule_hermes_restart()}
