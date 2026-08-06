"""Hermes runtime entrypoint for the BetterLife backend plugin."""


def register(_ctx) -> None:
    """BetterLife only contributes dashboard API routes; no agent hooks needed."""
