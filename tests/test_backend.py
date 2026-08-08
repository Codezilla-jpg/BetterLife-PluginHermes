from __future__ import annotations

import importlib.util
import asyncio
from pathlib import Path
import subprocess
import sys
import types
import unittest


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


if __name__ == "__main__":
    unittest.main()
