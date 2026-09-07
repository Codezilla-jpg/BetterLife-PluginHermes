from __future__ import annotations

import importlib.util
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import threading
import types
import unittest
from unittest.mock import patch


class _Router:
    def get(self, *_args, **_kwargs):
        return lambda function: function

    def post(self, *_args, **_kwargs):
        return lambda function: function


# The parser tests are intentionally dependency-free. Hermes supplies these
# modules when the backend plugin is loaded in the real gateway.
httpx = types.ModuleType("httpx")
httpx.Client = object
fastapi = types.ModuleType("fastapi")
fastapi.APIRouter = _Router
fastapi.HTTPException = type("HTTPException", (Exception,), {})
account_usage = types.ModuleType("agent.account_usage")
account_usage.fetch_account_usage = lambda _provider: None
setattr(account_usage, "build_nous_credits_snapshot", lambda _account: None)
credential_pool = types.ModuleType("agent.credential_pool")
credential_pool.load_pool = lambda _provider: None
agent = types.ModuleType("agent")
sys.modules.update(
    {
        "httpx": httpx,
        "fastapi": fastapi,
        "agent": agent,
        "agent.account_usage": account_usage,
        "agent.credential_pool": credential_pool,
    }
)

MODULE_PATH = Path(__file__).parents[1] / "backend" / "dashboard" / "plugin_api.py"
SPEC = importlib.util.spec_from_file_location("pulsebar_plugin_api", MODULE_PATH)
assert SPEC and SPEC.loader
API = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(API)


class GrokUsageParsingTests(unittest.TestCase):
    def test_weekly_and_monthly_usage(self) -> None:
        credits = {
            "config": {
                "creditUsagePercent": 16,
                "currentPeriod": {"end": "2026-08-09T00:00:00Z"},
                "productUsage": [{"product": "GrokBuild", "usagePercent": 16}],
            }
        }
        monthly = {
            "config": {
                "monthlyLimit": {"val": 15000},
                "used": {"val": 4169},
                "billingPeriodEnd": "2026-09-01T00:00:00Z",
            }
        }

        result = API._parse_grok_payloads(credits, monthly)

        self.assertTrue(result["available"])
        self.assertEqual(result["display_used_percent"], 16)
        self.assertEqual(result["display_reset_at"], "2026-08-09T00:00:00Z")
        self.assertEqual(result["windows"][0]["label"], "Grok Build")
        self.assertEqual(result["windows"][0]["used_percent"], 16)
        self.assertAlmostEqual(result["windows"][1]["used_percent"], 27.79, places=2)

    def test_invalid_payload_is_honestly_unavailable(self) -> None:
        result = API._parse_grok_payloads({}, {})
        self.assertFalse(result["available"])
        self.assertEqual(result["windows"], [])
        self.assertEqual(result["reason"], "Grok quota unavailable")

    def test_percent_is_bounded(self) -> None:
        self.assertIsNone(API._bounded_percent(-1))
        self.assertIsNone(API._bounded_percent(101))
        self.assertEqual(API._bounded_percent("42.5"), 42.5)


class CodexUsageParsingTests(unittest.TestCase):
    def test_rich_payload_includes_identity_and_model_windows(self) -> None:
        payload = {
            "email": "developer@example.invalid",
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {"used_percent": 12, "reset_at": 1_800_000_000},
                "secondary_window": {"used_percent": 34, "reset_at": 1_800_086_400},
            },
            "additional_rate_limits": [
                {
                    "limit_name": "GPT-5.3-Codex-Spark",
                    "rate_limit": {
                        "primary_window": {"used_percent": 56, "reset_at": 1_800_000_000},
                        "secondary_window": {
                            "used_percent": 78,
                            "reset_at": 1_800_086_400,
                            "limit_window_seconds": 604800,
                        },
                    },
                }
            ],
        }

        result = API._parse_codex(payload)

        self.assertEqual(result["account"], "developer@example.invalid")
        self.assertEqual(result["plan"], "Plus")
        self.assertEqual([window["used_percent"] for window in result["windows"]], [12, 34, 56, 78])
        self.assertTrue(result["windows"][0]["reset_at"].endswith("+00:00"))

    def test_unix_reset_time_is_serialized_as_iso_datetime(self) -> None:
        self.assertTrue(API._iso(1_800_000_000).endswith("+00:00"))

    def test_rich_request_preserves_codex_account_header(self) -> None:
        calls = []

        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {"rate_limit": {}}

        def requester(url, **kwargs):
            calls.append((url, kwargs))
            return Response()

        payload = API._fetch_codex_payload("token", "https://example.invalid/usage", "account-123", requester)

        self.assertEqual(payload, {"rate_limit": {}})
        self.assertEqual(calls[0][1]["headers"]["ChatGPT-Account-Id"], "account-123")

    def test_rich_failure_logs_before_canonical_fallback(self) -> None:
        with (
            patch.object(API, "_codex_credentials", side_effect=RuntimeError("test failure")),
            patch.object(API, "fetch_account_usage", return_value=None),
            self.assertLogs("pulsebar_plugin_api", level="DEBUG") as logs,
        ):
            result = API._codex_usage()

        self.assertFalse(result["available"])
        self.assertTrue(any("Codex" in message for message in logs.output))


class NousUsageTests(unittest.TestCase):
    def test_logged_in_account_without_quota_is_unavailable(self) -> None:
        nous_account = types.ModuleType("hermes_cli.nous_account")
        account = types.SimpleNamespace(
            logged_in=True,
            email="developer@example.invalid",
            subscription=None,
            paid_service_access_info=None,
            paid_service_access=None,
        )
        setattr(nous_account, "get_nous_portal_account_info", lambda **_kwargs: account)

        with patch.dict(sys.modules, {"hermes_cli.nous_account": nous_account}):
            result = API._nous_usage()

        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "Nous quota unavailable")
        self.assertEqual(result["account"], "developer@example.invalid")


class ProviderSnapshotTests(unittest.TestCase):
    def test_snapshot_contains_nous_codex_and_grok(self) -> None:
        setattr(API, "_CACHE_VALUE", None)
        with (
            patch.object(API, "_nous_usage", return_value={"id": "nous"}),
            patch.object(API, "_codex_usage", return_value={"id": "codex"}),
            patch.object(API, "_grok_usage", return_value={"id": "grok"}),
        ):
            snapshot = API.provider_usage_snapshot(force=True)
        setattr(API, "_CACHE_VALUE", None)

        self.assertEqual([provider["id"] for provider in snapshot["providers"]], ["nous", "codex", "grok"])

    def test_provider_collectors_run_in_parallel(self) -> None:
        barrier = threading.Barrier(3, timeout=1)

        def collect(provider_id):
            barrier.wait()
            return {"id": provider_id}

        setattr(API, "_CACHE_VALUE", None)
        with (
            patch.object(API, "_nous_usage", side_effect=lambda: collect("nous")),
            patch.object(API, "_codex_usage", side_effect=lambda: collect("codex")),
            patch.object(API, "_grok_usage", side_effect=lambda: collect("grok")),
        ):
            snapshot = API.provider_usage_snapshot(force=True)
        setattr(API, "_CACHE_VALUE", None)

        self.assertEqual([provider["id"] for provider in snapshot["providers"]], ["nous", "codex", "grok"])

    def test_concurrent_force_refreshes_share_one_collection(self) -> None:
        started = threading.Event()
        release = threading.Event()
        calls = 0

        def collect():
            nonlocal calls
            calls += 1
            started.set()
            self.assertTrue(release.wait(timeout=1))
            return [{"id": "nous"}, {"id": "codex"}, {"id": "grok"}]

        setattr(API, "_CACHE_VALUE", None)
        with patch.object(API, "_collect_provider_usage", side_effect=collect):
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(API.provider_usage_snapshot, True)
                self.assertTrue(started.wait(timeout=1))
                second = executor.submit(API.provider_usage_snapshot, True)
                threading.Event().wait(0.05)
                release.set()
                first.result(timeout=1)
                second.result(timeout=1)
        setattr(API, "_CACHE_VALUE", None)

        self.assertEqual(calls, 1)


class RestartTests(unittest.TestCase):
    def test_gateway_restart_uses_fixed_system_service_command(self) -> None:
        calls = []

        class Process:
            returncode = 0

            async def communicate(self):
                return b"", b""

        async def executor(*command, **kwargs):
            calls.append((command, kwargs))
            return Process()

        result = asyncio.run(API._restart_system_gateway(executor))

        self.assertEqual(result, {"ok": True, "target": "gateway"})
        self.assertEqual(calls[0][0], API._GATEWAY_RESTART_COMMAND)
        self.assertEqual(calls[0][1]["stdout"], asyncio.subprocess.PIPE)

    def test_gateway_restart_surfaces_service_failure(self) -> None:
        class Process:
            returncode = 1

            async def communicate(self):
                return b"", b"permission denied"

        async def executor(*_command, **_kwargs):
            return Process()

        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            asyncio.run(API._restart_system_gateway(executor))

    def test_hermes_restart_helper_escalates_for_stubborn_process(self) -> None:
        victim = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import signal,time; signal.signal(signal.SIGTERM, lambda *_: None); time.sleep(60)",
            ]
        )
        helper = MODULE_PATH.with_name("restart_helper.py")
        try:
            subprocess.run(
                [sys.executable, str(helper), str(victim.pid), "0.1", "0.2"],
                check=True,
                timeout=3,
            )
            self.assertLess(victim.wait(timeout=2), 0)
        finally:
            if victim.poll() is None:
                victim.kill()
                victim.wait()


class HostDirListingTests(unittest.TestCase):
    def test_lists_host_files_and_directories(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "app").mkdir()
            (root / "README.md").write_text("hi", encoding="utf-8")
            (root / ".env").write_text("secret", encoding="utf-8")
            (root / "node_modules").mkdir()

            result = API.list_host_dir(str(root))

            names = [entry["name"] for entry in result["entries"]]
            self.assertEqual(result["path"], str(root.resolve()))
            self.assertIn("app", names)
            self.assertIn("README.md", names)
            self.assertNotIn(".env", names)
            self.assertNotIn("node_modules", names)
            self.assertTrue(next(entry for entry in result["entries"] if entry["name"] == "app")["isDirectory"])
            self.assertFalse(next(entry for entry in result["entries"] if entry["name"] == "README.md")["isDirectory"])

    def test_missing_path_is_error(self) -> None:
        result = API.list_host_dir("/tmp/betterlife-missing-dir-xyz")
        self.assertEqual(result["error"], "ENOENT")
        self.assertEqual(result["entries"], [])


class SessionMoveTests(unittest.TestCase):
    def test_same_profile_is_noop(self) -> None:
        result = API.move_session_to_profile("sess-1", "developer", "developer", running_check=lambda _sid: False)
        self.assertTrue(result["ok"])
        self.assertTrue(result["unchanged"])

    def test_refuses_running_session(self) -> None:
        with self.assertRaises(PermissionError):
            API.move_session_to_profile(
                "sess-1",
                "developer",
                "personal",
                running_check=lambda _sid: True,
            )

    def test_missing_session_id(self) -> None:
        with self.assertRaises(ValueError):
            API.move_session_to_profile("", "developer", "personal", running_check=lambda _sid: False)

    def test_adopts_idle_session_and_closes_dbs(self) -> None:
        class FakeDB:
            def __init__(self, name, rows):
                self.name = name
                self.rows = dict(rows)
                self.closed = False
                self.retired = []
                self.backfilled = None

            def get_session(self, sid):
                return self.rows.get(sid)

            def export_session_lineage(self, sid):
                row = self.rows.get(sid)
                return None if row is None else {**row, "segments": [row], "messages": []}

            def adopt_session_lineage_from(self, donor, sid, retire_donor=True):
                payload = donor.export_session_lineage(sid)
                if not payload:
                    return {"ok": False, "adopted": False, "error": "not found"}
                self.rows[sid] = dict(payload)
                if retire_donor:
                    donor.retired.append(sid)
                    donor.rows.pop(sid, None)
                return {"ok": True, "adopted": True, "donor_retired": True, "imported": 1, "skipped": 0}

            def backfill_null_session_profiles(self, name):
                self.backfilled = name
                return 1

            def close(self):
                self.closed = True

        source = FakeDB("developer", {"sess-1": {"id": "sess-1", "title": "Chat"}})
        dest = FakeDB("personal", {})
        stores = {"developer": source, "personal": dest}

        result = API.move_session_to_profile(
            "sess-1",
            "developer",
            "personal",
            running_check=lambda _sid: False,
            db_opener=stores.__getitem__,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["adopted"])
        self.assertTrue(result["donor_retired"])
        self.assertIn("sess-1", dest.rows)
        self.assertNotIn("sess-1", source.rows)
        self.assertEqual(dest.backfilled, "personal")
        self.assertTrue(source.closed)
        self.assertTrue(dest.closed)

    def test_missing_session_raises(self) -> None:
        class EmptyDB:
            def get_session(self, _sid):
                return None

            def export_session_lineage(self, _sid):
                return None

            def close(self):
                return None

        with self.assertRaises(FileNotFoundError):
            API.move_session_to_profile(
                "missing",
                "developer",
                "personal",
                running_check=lambda _sid: False,
                db_opener=lambda _name: EmptyDB(),
            )


if __name__ == "__main__":
    unittest.main()
