from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest


class _Router:
    def get(self, *_args, **_kwargs):
        return lambda function: function


# The parser tests are intentionally dependency-free. Hermes supplies these
# modules when the backend plugin is loaded in the real gateway.
httpx = types.ModuleType("httpx")
httpx.Client = object
fastapi = types.ModuleType("fastapi")
fastapi.APIRouter = _Router
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
                "creditUsagePercent": 100,
                "currentPeriod": {"end": "2026-08-09T00:00:00Z"},
                "productUsage": [{"product": "GrokBuild", "usagePercent": 100}],
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
        self.assertEqual(result["windows"][0]["used_percent"], 100)
        self.assertAlmostEqual(result["windows"][1]["used_percent"], 27.79, places=2)
        self.assertIn("Grok Build: 100% used", result["details"])

    def test_invalid_payload_is_honestly_unavailable(self) -> None:
        result = API._parse_grok_payloads({}, {})
        self.assertFalse(result["available"])
        self.assertEqual(result["windows"], [])
        self.assertEqual(result["reason"], "Grok quota unavailable")

    def test_percent_is_bounded(self) -> None:
        self.assertIsNone(API._bounded_percent(-1))
        self.assertIsNone(API._bounded_percent(101))
        self.assertEqual(API._bounded_percent("42.5"), 42.5)


if __name__ == "__main__":
    unittest.main()
