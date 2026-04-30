#!/usr/bin/env python3
# On Joel's system: "C:/Users/joelb/AppData/Local/Python/bin/python3.exe" council.py ...
"""
FastOps Council — Multi-Model GroupChat via AutoGen + OpenRouter

Launches a team of AI models that can see each other's responses
and have a real conversation. Uses OpenRouter so all models go
through one API.

Usage:
  python3 council.py "What should we build next?"
  python3 council.py --rounds 5 "Review our boot camp architecture"
  python3 council.py --models gpt,grok,gemini "Debate this approach"

Models available: gpt, gemini, grok, deepseek, claude
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Load .env
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            key = key.strip()
            if key not in os.environ:
                os.environ[key] = val.strip()

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.conditions import MaxMessageTermination
from autogen_ext.models.openai import OpenAIChatCompletionClient

ROOT = Path(__file__).parent.parent
COMMS_FILE = ROOT / ".fastops" / "comms.jsonl"
CLAUDE_MD = ROOT / ".claude" / "CLAUDE.md"

OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
if not OPENROUTER_KEY:
    print("ERROR: OPENROUTER_API_KEY not set in .env")
    sys.exit(1)

# Model configs via OpenRouter
MODEL_CONFIGS = {
    "gpt": {
        "id": "openai/gpt-4o",
        "name": "GPT4o",
        "display": "GPT-4o",
        "role": "Solution Architect — maps connections, proposes unified solutions",
    },
    "gemini": {
        "id": "google/gemini-2.5-pro-preview-06-05",
        "name": "Gemini",
        "display": "Gemini 2.5 Pro",
        "role": "Devil's Advocate — stress-tests breakthroughs and assumptions",
    },
    "grok": {
        "id": "x-ai/grok-3-mini-beta",
        "name": "Grok",
        "display": "Grok 3 Mini",
        "role": "Strategic Challenger — military strategy, operational control",
    },
    "deepseek": {
        "id": "deepseek/deepseek-chat",
        "name": "DeepSeek",
        "display": "DeepSeek V3",
        "role": "Root Cause Analyst — deep problem decomposition",
    },
    "claude": {
        "id": "anthropic/claude-sonnet-4",
        "name": "Claude",
        "display": "Claude Sonnet",
        "role": "Builder — implementation, code architecture, system design",
    },
}

# Load project context
project_context = ""
if CLAUDE_MD.exists():
    project_context = CLAUDE_MD.read_text()[:5000]

SYSTEM_BASE = """You are {name}, a team member on the FastOps AI project.
YOUR ROLE: {role}

PROJECT: FastOps AI — A reasoning framework for AI agents leveraging Navy SEAL best practices.
Core thesis: reasoning traces are the product. How agents think matters more than what they build.

You are in a LIVE COUNCIL with other AI models. Each model brings a DISTINCT perspective.
- Be direct. No filler. Lead with your point.
- Build on what others said. Reference specific points.
- Disagree openly when you see a gap.
- 2-3 paragraphs max per response.

PROJECT CONTEXT:
{context}
"""


def post_to_comms(sender: str, message: str):
    """Write a message to the FastOps comms channel."""
    entry = {"ts": datetime.now(tz=__import__('datetime').timezone.utc).isoformat(), "from": sender, "message": message}
    with open(COMMS_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def create_agent(key: str) -> AssistantAgent:
    """Create an AutoGen agent backed by an OpenRouter model."""
    cfg = MODEL_CONFIGS[key]
    client = OpenAIChatCompletionClient(
        model=cfg["id"],
        api_key=OPENROUTER_KEY,
        base_url="https://openrouter.ai/api/v1",
        model_info={
            "vision": False,
            "function_calling": True,
            "json_output": True,
            "family": "unknown",
            "structured_output": False,
        },
    )
    system = SYSTEM_BASE.format(
        name=cfg["name"],
        role=cfg["role"],
        context=project_context[:3000],
    )
    return AssistantAgent(name=cfg["name"].replace(" ", "_").replace(".", "_"), model_client=client, system_message=system)


async def run_council(topic: str, model_keys: list[str], max_rounds: int):
    """Run a multi-model council on a topic."""
    print(f"\n{'='*60}")
    print(f"  FASTOPS COUNCIL")
    print(f"  Topic: {topic}")
    print(f"  Models: {', '.join(MODEL_CONFIGS[k]['display'] for k in model_keys)}")
    print(f"  Rounds: {max_rounds}")
    print(f"{'='*60}\n")

    # Log council start to comms
    post_to_comms("Council", f"Council convened. Topic: {topic}. Models: {', '.join(MODEL_CONFIGS[k]['display'] for k in model_keys)}")

    agents = [create_agent(k) for k in model_keys]
    # +1 for the initial task message which counts toward the limit
    termination = MaxMessageTermination(max_messages=max_rounds * len(agents) + 1)
    team = RoundRobinGroupChat(agents, termination_condition=termination)

    # Stream the conversation
    async for event in team.run_stream(task=topic):
        if hasattr(event, "source") and hasattr(event, "content"):
            source = event.source
            content = event.content
            if content and isinstance(content, str):
                print(f"\n--- {source} ---")
                print(content)
                # Log each response to comms
                summary = content[:200] + "..." if len(content) > 200 else content
                post_to_comms(source, summary)

    post_to_comms("Council", f"Council concluded. Topic: {topic}")
    print(f"\n{'='*60}")
    print("  COUNCIL CONCLUDED")
    print(f"  Transcript logged to comms.jsonl")
    print(f"{'='*60}\n")


def main():
    args = sys.argv[1:]
    max_rounds = 3
    model_keys = ["gpt", "grok", "deepseek"]  # Default team

    # Parse args
    topic_parts = []
    i = 0
    while i < len(args):
        if args[i] == "--rounds" and i + 1 < len(args):
            max_rounds = int(args[i + 1])
            i += 2
        elif args[i] == "--models" and i + 1 < len(args):
            model_keys = [k.strip() for k in args[i + 1].split(",")]
            i += 2
        else:
            topic_parts.append(args[i])
            i += 1

    topic = " ".join(topic_parts)
    if not topic:
        print("Usage: python3 council.py [--rounds N] [--models gpt,grok,...] 'topic'")
        print(f"Available models: {', '.join(MODEL_CONFIGS.keys())}")
        sys.exit(1)

    # Validate models
    for k in model_keys:
        if k not in MODEL_CONFIGS:
            print(f"Unknown model: {k}. Available: {', '.join(MODEL_CONFIGS.keys())}")
            sys.exit(1)

    asyncio.run(run_council(topic, model_keys, max_rounds))


if __name__ == "__main__":
    main()
