import os
import sys
import json
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import hashlib, time

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


@app.post("/deploy-model")
async def deploy_model_file(
    file: UploadFile = File(...),
    model_name: str = Form(...),
    environment: str = Form("staging"),
    version: str = Form(""),
    provider: str = Form("ollama"),
    model: str = Form("ollama/llama3.2"),
    api_key: str = Form(""),
):
    if not file.filename.endswith(".py"):
        return JSONResponse(status_code=400, content={"error": "Only .py files are supported"})

    contents = await file.read()
    size_kb = round(len(contents) / 1024, 1)

    # Derive version from content hash if not provided
    resolved_version = version or ("v" + hashlib.sha256(contents).hexdigest()[:7])
    ts = int(time.time())

    # Register the upload in the mock platform
    platform._models[model_name] = {
        "name": model_name,
        "version": resolved_version,
        "stage": environment,
        "file": file.filename,
        "size_kb": size_kb,
        "registered_at": ts,
        "source": "file_upload",
    }

    # Ask the agent to narrate the deploy
    resolved_key = api_key or os.environ.get("OPENAI_API_KEY", "")
    agent = get_agent(provider, model, resolved_key)
    summary_msg = (
        f"A model file '{file.filename}' ({size_kb} KB) was just uploaded and registered as "
        f"'{model_name}' version {resolved_version} targeting {environment}. "
        f"Confirm the deployment in a friendly 2-sentence message to the engineer."
    )
    response = agent.chat(summary_msg, verbose=False)

    return {
        "response": response,
        "tool_calls": [{
            "tool": "deploy_model_file",
            "args": {"model_name": model_name, "version": resolved_version, "environment": environment, "file": file.filename},
            "result": {"status": "registered", "version": resolved_version, "stage": environment}
        }]
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
