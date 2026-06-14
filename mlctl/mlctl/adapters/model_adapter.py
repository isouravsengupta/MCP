from abc import ABC, abstractmethod
from typing import Optional
import os

import litellm
from litellm import completion

litellm.drop_params = True


SUPPORTED_PROVIDERS = {
    "ollama": {
        "label": "Ollama (Local)",
        "models": ["ollama/llama3.2", "ollama/llama3.1", "ollama/mistral", "ollama/gemma2"],
        "key_env": None,
        "key_prefix": None,
        "local": True,
    },
    "openai": {
        "label": "OpenAI",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
        "key_env": "OPENAI_API_KEY",
        "key_prefix": "sk-proj-",
    },
    "anthropic": {
        "label": "Anthropic",
        "models": ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
        "key_env": "ANTHROPIC_API_KEY",
        "key_prefix": "sk-ant-",
    },
    "azure": {
        "label": "Azure OpenAI",
        "models": ["azure/gpt-4o-mini", "azure/gpt-4o"],
        "key_env": "AZURE_API_KEY",
        "key_prefix": None,
    },
    "bedrock": {
        "label": "AWS Bedrock",
        "models": ["bedrock/anthropic.claude-3-haiku", "bedrock/amazon.titan-text-express-v1"],
        "key_env": "AWS_ACCESS_KEY_ID",
        "key_prefix": None,
    },
    "netflix": {
        "label": "Netflix Internal",
        "models": ["netflix/internal-llm"],
        "key_env": "NETFLIX_MODEL_API_KEY",
        "key_prefix": None,
        "disabled": True,
        "disabled_reason": "Requires Netflix internal SDK — swap adapter in production",
    },
}


class BaseModelAdapter(ABC):
    """
    Swap any LLM into mlctl by implementing this interface.
    Netflix injects their internal model here in production.
    """

    @abstractmethod
    def chat(self, messages: list[dict], tools: list[dict] = None) -> object:
        pass


class LiteLLMAdapter(BaseModelAdapter):
    """
    Unified adapter for any LiteLLM-supported provider.
    Covers OpenAI, Anthropic, Azure, Bedrock, and 100+ others
    with a single interface.
    """

    def __init__(self, model: str = "gpt-4o-mini", api_key: Optional[str] = None):
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def chat(self, messages: list[dict], tools: list[dict] = None) -> object:
        kwargs = {
            "model": self.model,
            "messages": messages,
            "api_key": self.api_key,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = completion(**kwargs)
        return response.choices[0].message


class NetflixModelAdapter(BaseModelAdapter):
    """
    Placeholder for Netflix's internal LLM.
    Replace self._call with Netflix's internal SDK.
    """

    def __init__(self, endpoint: str, api_key: str):
        self.endpoint = endpoint
        self.api_key = api_key

    def chat(self, messages: list[dict], tools: list[dict] = None) -> object:
        raise NotImplementedError(
            "Inject Netflix's internal model client here. "
            "Implement this method using Netflix's internal LLM SDK."
        )


def get_adapter(
    provider: str = "openai",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> BaseModelAdapter:
    if provider == "netflix":
        return NetflixModelAdapter(
            endpoint=os.environ.get("NETFLIX_MODEL_ENDPOINT", ""),
            api_key=os.environ.get("NETFLIX_MODEL_API_KEY", ""),
        )

    defaults = {
        "ollama": "ollama/llama3.2",
        "openai": "gpt-4o-mini",
        "anthropic": "claude-haiku-4-5-20251001",
        "azure": "azure/gpt-4o-mini",
        "bedrock": "bedrock/anthropic.claude-3-haiku",
    }
    resolved_model = model or defaults.get(provider, "gpt-4o-mini")

    # Ollama runs locally — no API key needed
    if provider == "ollama":
        return LiteLLMAdapter(model=resolved_model, api_key=None)

    resolved_key = (
        api_key
        or os.environ.get(SUPPORTED_PROVIDERS.get(provider, {}).get("key_env", "") or "", "")
        or os.environ.get("OPENAI_API_KEY", "")
    )

    return LiteLLMAdapter(model=resolved_model, api_key=resolved_key)
