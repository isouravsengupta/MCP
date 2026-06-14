import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from db.query_engine import insert_model, get_models, update_model_stage


class ModelTools:
    def __init__(self, platform=None):
        self.platform = platform

    def register_model(self, run_id: str, model_name: str, stage: str = "staging") -> dict:
        version = f"{len(get_models()) + 1}.0"
        result = insert_model(run_id, model_name, version, stage)
        return {"registered": True, "model": result}

    def deploy_model(self, model_name: str, version: str, environment: str) -> dict:
        return update_model_stage(model_name, environment)

    def get_model_status(self, model_name: str) -> dict:
        models = get_models()
        match = next((m for m in models if m["name"] == model_name), None)
        return match or {"error": f"Model {model_name} not found"}

    def list_models(self) -> list[dict]:
        return get_models()

    def rollback_model(self, model_name: str, to_version: str) -> dict:
        return update_model_stage(model_name, "staging")
