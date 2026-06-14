#!/usr/bin/env python3
"""
mlctl MCP Server

Exposes the ML Platform Agent as an MCP server so it can be used
from Claude Desktop, VS Code, Slack bots, or any MCP-compatible interface.

Netflix would swap the model adapter for their internal LLM here.
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

from mlctl.agent.orchestrator import MLOrchestrator
from mlctl.adapters.model_adapter import get_adapter
from mock.platform_mock import MockPlatform

app = Server("mlctl")

platform = MockPlatform()
adapter = get_adapter(os.environ.get("MODEL_PROVIDER", "openai"))
agent = MLOrchestrator(model_adapter=adapter, platform=platform)


@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="mlctl_chat",
            description=(
                "Talk to the mlctl ML Platform Agent in natural language. "
                "Ask it to run experiments, compare models, deploy to staging/production, "
                "trigger pipelines, or orchestrate the full ML lifecycle end-to-end."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Your natural language instruction to the ML platform agent"
                    },
                    "reset_session": {
                        "type": "boolean",
                        "description": "Set to true to start a fresh conversation",
                        "default": False
                    }
                },
                "required": ["message"]
            }
        ),
        types.Tool(
            name="mlctl_list_experiments",
            description="Directly list recent ML experiments and their metrics",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 5}
                }
            }
        ),
        types.Tool(
            name="mlctl_list_models",
            description="Directly list all registered models and their deployment status",
            inputSchema={"type": "object", "properties": {}}
        ),
        types.Tool(
            name="mlctl_list_pipelines",
            description="Directly list all available ML pipelines",
            inputSchema={"type": "object", "properties": {}}
        )
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "mlctl_chat":
        if arguments.get("reset_session"):
            agent.reset()

        response = agent.chat(arguments["message"], verbose=False)
        return [types.TextContent(type="text", text=response)]

    elif name == "mlctl_list_experiments":
        results = agent.experiments.list_experiments(arguments.get("limit", 5))
        return [types.TextContent(type="text", text=json.dumps(results, indent=2))]

    elif name == "mlctl_list_models":
        results = agent.models.list_models()
        return [types.TextContent(type="text", text=json.dumps(results, indent=2))]

    elif name == "mlctl_list_pipelines":
        results = agent.pipelines.list_pipelines()
        return [types.TextContent(type="text", text=json.dumps(results, indent=2))]

    return [types.TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
