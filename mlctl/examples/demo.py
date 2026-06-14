#!/usr/bin/env python3
"""
mlctl Demo

Run this to see the ML Platform Agent in action.
It demonstrates a full ML lifecycle:
  1. List existing experiments
  2. Run a new experiment
  3. Compare all runs and find the best
  4. Register the best model
  5. Deploy to staging
  6. Confirm deployment status

Usage:
    python examples/demo.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mlctl.agent.orchestrator import MLOrchestrator
from mlctl.adapters.model_adapter import get_adapter
from mock.platform_mock import MockPlatform


def print_banner():
    print("""
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        mlctl — ML Platform Agent for Netflix             ║
║        Natural language interface for the ML lifecycle   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
""")


def run_demo():
    print_banner()

    platform = MockPlatform()
    adapter = get_adapter("openai")
    agent = MLOrchestrator(model_adapter=adapter, platform=platform)

    scenarios = [
        {
            "title": "SCENARIO 1 — Explore existing experiments",
            "message": "Show me all recent experiments and their accuracy metrics."
        },
        {
            "title": "SCENARIO 2 — Run a new experiment",
            "message": "Run a new experiment called 'attention_recommender' with learning rate 0.0003, 25 epochs, and batch size 512."
        },
        {
            "title": "SCENARIO 3 — Full lifecycle: compare, register, deploy",
            "message": (
                "Compare all experiments we have. Find the best one by accuracy, "
                "register it as 'netflix_recommender', and deploy it to staging."
            )
        },
        {
            "title": "SCENARIO 4 — Check deployment status",
            "message": "What is the current status of the netflix_recommender model?"
        }
    ]

    for scenario in scenarios:
        print(f"\n{'─'*60}")
        print(f"📋 {scenario['title']}")
        print(f"{'─'*60}")
        agent.chat(scenario["message"], verbose=True)
        input("\n  ↵  Press Enter to continue to next scenario...\n")


if __name__ == "__main__":
    run_demo()
