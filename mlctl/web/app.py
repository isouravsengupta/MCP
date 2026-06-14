import os
import sys
import json
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

from mlctl.agent.orchestrator import MLOrchestrator
from mlctl.adapters.model_adapter import get_adapter, SUPPORTED_PROVIDERS
from mock.platform_mock import MockPlatform

app = FastAPI(title="mlctl — ML Platform Agent")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

HTML_PATH = os.path.join(os.path.dirname(__file__), "templates", "index.html")

platform = MockPlatform()
_agents: dict[str, MLOrchestrator] = {}


def get_agent(provider: str, model: str, api_key: str) -> MLOrchestrator:
    key = f"{provider}:{model}"
    if key not in _agents:
        adapter = get_adapter(provider=provider, model=model, api_key=api_key)
        _agents[key] = MLOrchestrator(model_adapter=adapter, platform=platform)
    else:
        # update api_key in case it changed
        _agents[key].adapter.api_key = api_key
    return _agents[key]


class ChatRequest(BaseModel):
    message: str
    provider: str = "openai"
    model: str = "gpt-4o-mini"
    api_key: str = ""
    reset: bool = False


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(HTML_PATH, "r") as f:
        return HTMLResponse(content=f.read())


@app.post("/chat")
async def chat(req: ChatRequest):
    api_key = req.api_key or os.environ.get("OPENAI_API_KEY", "")
    agent = get_agent(req.provider, req.model, api_key)

    if req.reset:
        agent.reset()

    tool_calls_log = []
    original_dispatch = agent._dispatch_tool

    def tracked_dispatch(tool_name, args):
        result = original_dispatch(tool_name, args)
        tool_calls_log.append({
            "tool": tool_name,
            "args": args,
            "result": json.loads(result)
        })
        return result

    agent._dispatch_tool = tracked_dispatch
    response = agent.chat(req.message, verbose=False)
    agent._dispatch_tool = original_dispatch

    return {"response": response, "tool_calls": tool_calls_log}


@app.post("/reset")
async def reset(req: ChatRequest):
    key = f"{req.provider}:{req.model}"
    if key in _agents:
        _agents[key].reset()
    return {"status": "reset"}


@app.get("/providers")
async def providers():
    return SUPPORTED_PROVIDERS


@app.get("/health")
async def health():
    return {"status": "ok"}
