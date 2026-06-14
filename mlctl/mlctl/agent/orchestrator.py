import json
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from mlctl.adapters.model_adapter import BaseModelAdapter
from mlctl.tools.experiments import ExperimentTools
from mlctl.tools.models import ModelTools
from mlctl.tools.pipelines import PipelineTools
from db.query_engine import text_to_sql


SYSTEM_PROMPT = """You are mlctl, an intelligent ML platform agent for Netflix's AI Platform.

You help ML researchers and data scientists orchestrate the full ML lifecycle:
- Running and comparing experiments
- Registering and deploying models
- Triggering and monitoring pipelines

CRITICAL RULES — follow these exactly:
1. ONLY call tools when the user explicitly asks for ML platform data or actions.
   Examples that REQUIRE tools: "show experiments", "deploy the best model", "compare runs", "list pipelines".
   Examples that DO NOT need tools: "hey", "hi", "hello", "thanks", "what can you do?", "how are you?".
2. For greetings, casual messages, or general questions — respond naturally in plain text. Do NOT call any tools.
3. Never call tools speculatively or "just to check". Wait for a clear request.
4. After calling tools once, synthesise the results into a clear, concise response. Do not call more tools.
5. Format responses cleanly — use bullet points for lists, avoid raw JSON in your reply.
"""

# Keywords that indicate the user wants ML platform actions
_ACTION_KEYWORDS = {
    "run", "list", "show", "deploy", "compare", "register", "status",
    "pipeline", "model", "experiment", "query", "find", "trigger",
    "rollback", "check", "get", "what", "which", "how many", "accuracy",
    "training", "metrics", "staging", "production", "sql",
}

_CONVERSATIONAL_PATTERNS = {
    "hey", "hi", "hello", "thanks", "thank you", "bye", "goodbye",
    "what can you do", "help", "who are you", "how are you", "what are you",
    "sup", "yo", "ok", "okay", "cool", "nice", "great", "awesome", "got it",
    "sounds good", "perfect", "yes", "no", "sure", "please", "cheers",
}

def _is_conversational(message: str) -> bool:
    msg = message.strip().lower().rstrip("!.,? ")
    # Exact match against known conversational phrases
    if msg in _CONVERSATIONAL_PATTERNS:
        return True
    # Short message with no action keywords → treat as conversational
    words = msg.split()
    if len(words) <= 3:
        return not any(kw in msg for kw in _ACTION_KEYWORDS)
    return False

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_experiment",
            "description": "Run a new ML training experiment with given hyperparameters",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name for this experiment run"},
                    "params": {
                        "type": "object",
                        "description": "Hyperparameters as key-value pairs e.g. {lr: 0.001, epochs: 10}"
                    }
                },
                "required": ["name", "params"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_experiments",
            "description": "List recent ML experiments with their metrics",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Number of recent runs to return", "default": 5}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_runs",
            "description": "Compare multiple experiment runs and identify the best one by accuracy",
            "parameters": {
                "type": "object",
                "properties": {
                    "run_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of run IDs to compare"
                    }
                },
                "required": ["run_ids"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "register_model",
            "description": "Register a trained model from an experiment run into the model registry",
            "parameters": {
                "type": "object",
                "properties": {
                    "run_id": {"type": "string", "description": "The experiment run ID to register"},
                    "model_name": {"type": "string", "description": "Name for the registered model"},
                    "stage": {"type": "string", "description": "Stage: staging or production", "default": "staging"}
                },
                "required": ["run_id", "model_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "deploy_model",
            "description": "Deploy a registered model to staging or production environment",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_name": {"type": "string"},
                    "version": {"type": "string"},
                    "environment": {"type": "string", "description": "Target environment: staging or production"}
                },
                "required": ["model_name", "version", "environment"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_model_status",
            "description": "Get the current status and metrics of a deployed model",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_name": {"type": "string"}
                },
                "required": ["model_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_pipeline",
            "description": "Trigger an ML pipeline such as feature engineering or training pipeline",
            "parameters": {
                "type": "object",
                "properties": {
                    "pipeline_name": {"type": "string", "description": "Name of the pipeline to trigger"},
                    "params": {"type": "object", "description": "Optional parameters for the pipeline"}
                },
                "required": ["pipeline_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_pipelines",
            "description": "List all available ML pipelines and their last run status",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "rollback_model",
            "description": "Rollback a model to a previous version if a regression is detected",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_name": {"type": "string"},
                    "to_version": {"type": "string", "description": "Version to roll back to"}
                },
                "required": ["model_name", "to_version"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "natural_language_query",
            "description": (
                "Query the ML platform database using plain English. "
                "Use this for ad-hoc questions like 'experiments last week above 90% accuracy' "
                "or 'which models are in production'. Converts NL to SQL automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question in plain English e.g. 'show experiments with accuracy above 0.92 from last week'"
                    }
                },
                "required": ["question"]
            }
        }
    }
]


class MLOrchestrator:
    def __init__(self, model_adapter: BaseModelAdapter, platform):
        self.adapter = model_adapter
        self.experiments = ExperimentTools(platform)
        self.models = ModelTools(platform)
        self.pipelines = PipelineTools(platform)
        self.history = [{"role": "system", "content": SYSTEM_PROMPT}]

    def _dispatch_tool(self, tool_name: str, args: dict) -> str:
        dispatch = {
            "run_experiment": lambda a: self.experiments.run_experiment(a["name"], a["params"]),
            "list_experiments": lambda a: self.experiments.list_experiments(int(a.get("limit", 5))),
            "compare_runs": lambda a: self.experiments.compare_runs(a["run_ids"]),
            "register_model": lambda a: self.models.register_model(a["run_id"], a["model_name"], a.get("stage", "staging")),
            "deploy_model": lambda a: self.models.deploy_model(a["model_name"], a["version"], a["environment"]),
            "get_model_status": lambda a: self.models.get_model_status(a["model_name"]),
            "list_pipelines": lambda a: self.pipelines.list_pipelines(),
            "trigger_pipeline": lambda a: self.pipelines.trigger_pipeline(a["pipeline_name"], a.get("params", {})),
            "rollback_model": lambda a: self.models.rollback_model(a["model_name"], a["to_version"]),
            "natural_language_query": lambda a: json.dumps(text_to_sql(a["question"], self.adapter)),
        }
        if tool_name not in dispatch:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        result = dispatch[tool_name](args)
        return json.dumps(result, indent=2)

    def chat(self, user_message: str, verbose: bool = True) -> str:
        self.history.append({"role": "user", "content": user_message})

        if verbose:
            print(f"\n{'='*60}")
            print(f"USER: {user_message}")
            print(f"{'='*60}")

        max_iterations = 10
        iteration = 0
        tools_called_this_turn = set()

        # Skip tools entirely for casual/conversational messages
        skip_tools = _is_conversational(user_message)

        while iteration < max_iterations:
            iteration += 1

            # No tools on conversational turns or after first tool batch
            current_tools = TOOLS if (not tools_called_this_turn and not skip_tools) else None

            response = self.adapter.chat(self.history, tools=current_tools)

            if response.tool_calls and current_tools:
                self.history.append({"role": "assistant", "content": response.content, "tool_calls": response.tool_calls})

                for tool_call in response.tool_calls:
                    tool_name = tool_call.function.name
                    args = json.loads(tool_call.function.arguments)
                    tools_called_this_turn.add(tool_name)

                    if verbose:
                        print(f"\n🔧 Tool Call: {tool_name}")
                        print(f"   Args: {json.dumps(args, indent=2)}")

                    result = self._dispatch_tool(tool_name, args)

                    if verbose:
                        result_preview = json.loads(result)
                        print(f"   Result: {json.dumps(result_preview, indent=2)[:300]}...")

                    self.history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result
                    })

                # After collecting tool results, add a nudge for models that loop
                self.history.append({
                    "role": "user",
                    "content": "Based on the tool results above, please provide a clear summary to the user. Do not call any more tools."
                })

            else:
                final_response = response.content
                self.history.append({"role": "assistant", "content": final_response})
                if verbose:
                    print(f"\n🤖 mlctl: {final_response}\n")
                return final_response

        return "Max iterations reached. Please refine your request."

    def reset(self):
        self.history = [{"role": "system", "content": SYSTEM_PROMPT}]
