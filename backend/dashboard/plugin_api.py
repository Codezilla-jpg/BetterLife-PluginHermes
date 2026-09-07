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


def _codex_credentials() -> tuple[Optional[str], str, Optional[str]]:
    from agent.account_usage import (
        _resolve_codex_usage_credentials,
        _resolve_codex_usage_url,
    )

    token, base_url, account_id = _resolve_codex_usage_credentials(None, None)
    return token, _resolve_codex_usage_url(base_url), account_id


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
    if snapshot is None:
        return _unavailable("codex", "OpenAI Codex", "Codex quota unavailable")
    windows = [
        _window(
            item.label.lower().replace(" ", "-"),
            item.label,
            item.used_percent,
            item.reset_at,
            item.detail,
        )
        for item in snapshot.windows
    ]
    return {
        "id": "codex",
        "label": "OpenAI Codex",
        "available": bool(windows),
        "reason": None if windows else "Codex quota unavailable",
        "account": None,
        "plan": snapshot.plan,
        "windows": windows,
        "details": list(snapshot.details),
    }


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
    collectors = (_nous_usage, _codex_usage, _grok_usage)
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


_FS_SKIP_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "target",
    "venv",
}
_FS_SKIP_FILES = {
    "auth.json",
    "auth.lock",
    "credentials",
    "config.yaml",
    ".env",
    ".envrc",
}
_DEFAULT_WORKSPACE_ROOTS = (
    Path("/home/hermes/1_Projekte"),
    Path.home(),
    Path("/"),
)


def default_workspace_root() -> Path:
    for candidate in _DEFAULT_WORKSPACE_ROOTS:
        try:
            if candidate.is_dir():
                return candidate.resolve()
        except OSError:
            continue
    return Path("/")


def list_host_dir(path: str = "") -> dict[str, Any]:
    raw = str(path or "").strip() or str(default_workspace_root())
    try:
        target = Path(raw).expanduser().resolve()
    except (OSError, RuntimeError):
        return {"path": raw, "entries": [], "error": "EINVAL"}
    try:
        if not target.exists():
            return {"path": str(target), "entries": [], "error": "ENOENT"}
        if not target.is_dir():
            return {"path": str(target), "entries": [], "error": "ENOTDIR"}
    except OSError as exc:
        return {"path": str(target), "entries": [], "error": getattr(exc, "strerror", None) or "read-error"}

    entries: list[dict[str, Any]] = []
    try:
        with os.scandir(target) as scan:
            for entry in scan:
                name = entry.name
                lowered = name.lower()
                if name.startswith(".") or name in _FS_SKIP_NAMES or lowered in _FS_SKIP_FILES:
                    continue
                if lowered.startswith(".env."):
                    continue
                try:
                    is_directory = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                entries.append(
                    {
                        "name": name,
                        "path": str(target / name),
                        "isDirectory": is_directory,
                    }
                )
    except OSError as exc:
        return {"path": str(target), "entries": [], "error": getattr(exc, "strerror", None) or "read-error"}

    entries.sort(key=lambda item: (not item["isDirectory"], item["name"].lower(), item["name"]))
    parent = str(target.parent) if target.parent != target else None
    return {"path": str(target), "parent": parent, "entries": entries}


def _canon_profile(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        return "default"
    try:
        from hermes_cli.profiles import normalize_profile_name

        return normalize_profile_name(text)
    except Exception:
        return text.lower()


def session_is_running(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    server = sys.modules.get("tui_gateway.server")
    if server is None:
        return False
    sessions = getattr(server, "_sessions", {}) or {}

    def _scan() -> bool:
        for sess in list(sessions.values()):
            if not isinstance(sess, dict):
                continue
            keys = {
                str(sess.get("session_key") or "").strip(),
                str(sess.get("id") or "").strip(),
                str(sess.get("session_id") or "").strip(),
            }
            if sid in keys and sess.get("running"):
                return True
        return False

    lock = getattr(server, "_sessions_lock", None)
    if lock is not None:
        with lock:
            return _scan()
    return _scan()


def _open_profile_session_db(name: str):
    from hermes_cli.profiles import get_profile_dir, profile_exists
    from hermes_state import SessionDB

    canon = _canon_profile(name)
    if not profile_exists(canon):
        raise FileNotFoundError(f"unknown profile: {canon}")
    return SessionDB(db_path=get_profile_dir(canon) / "state.db")


def _close_db(db: Any) -> None:
    closer = getattr(db, "close", None)
    if closer is None:
        return
    try:
        closer()
    except Exception:
        _LOGGER.debug("session db close failed", exc_info=True)


def move_session_to_profile(
    session_id: str,
    from_profile: str,
    to_profile: str,
    *,
    running_check: Any = None,
    db_opener: Any = None,
) -> dict[str, Any]:
    sid = str(session_id or "").strip()
    if not sid:
        raise ValueError("session_id required")
    src = _canon_profile(from_profile)
    dst = _canon_profile(to_profile)
    if src == dst:
        return {
            "ok": True,
            "unchanged": True,
            "session_id": sid,
            "from_profile": src,
            "to_profile": dst,
        }
    check = running_check or session_is_running
    if check(sid):
        raise PermissionError("session is running")
    opener = db_opener or _open_profile_session_db
    source_db = opener(src)
    dest_db = None
    try:
        if source_db.get_session(sid) is None and not source_db.export_session_lineage(sid):
            raise FileNotFoundError(f"session not found: {sid}")
        dest_db = opener(dst)
        result = dest_db.adopt_session_lineage_from(source_db, sid, retire_donor=True)
        if not result.get("adopted"):
            raise RuntimeError(result.get("error") or "adoption failed")
        backfill = getattr(dest_db, "backfill_null_session_profiles", None)
        if backfill is not None:
            backfill(dst)
        return {
            "ok": True,
            "unchanged": False,
            "session_id": sid,
            "from_profile": src,
            "to_profile": dst,
            "adopted": True,
            "donor_retired": bool(result.get("donor_retired")),
            "imported": result.get("imported"),
            "skipped": result.get("skipped"),
        }
    finally:
        _close_db(source_db)
        _close_db(dest_db)


@router.get("/fs/list")
async def fs_list(path: str = "") -> dict[str, Any]:
    return await asyncio.to_thread(list_host_dir, path)


@router.post("/session/move")
async def session_move(session_id: str = "", from_profile: str = "", to_profile: str = "") -> dict[str, Any]:
    try:
        return await asyncio.to_thread(move_session_to_profile, session_id, from_profile, to_profile)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"session move failed: {exc}") from exc


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
