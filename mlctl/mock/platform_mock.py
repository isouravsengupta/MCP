import random
import time
import uuid


class MockPlatform:
    """
    Simulates Netflix's internal ML platform APIs.
    Replace with real platform clients in production.
    """

    def __init__(self):
        self._experiments = {
            "run_001": {"run_id": "run_001", "name": "baseline_recommender", "params": {"lr": 0.01, "epochs": 10, "batch_size": 64}, "metrics": {"accuracy": 0.8821, "loss": 0.3412, "f1": 0.871}, "status": "completed", "duration_s": 1820},
            "run_002": {"run_id": "run_002", "name": "tuned_recommender", "params": {"lr": 0.001, "epochs": 15, "batch_size": 128}, "metrics": {"accuracy": 0.9103, "loss": 0.2891, "f1": 0.902}, "status": "completed", "duration_s": 2640},
            "run_003": {"run_id": "run_003", "name": "deep_recommender", "params": {"lr": 0.0005, "epochs": 20, "batch_size": 256}, "metrics": {"accuracy": 0.9247, "loss": 0.2541, "f1": 0.919}, "status": "completed", "duration_s": 4210},
        }
        self._models = {
            "recommender_v1": {"name": "recommender_v1", "version": "1.0", "stage": "production", "run_id": "run_001", "accuracy": 0.8821},
            "recommender_v2": {"name": "recommender_v2", "version": "2.0", "stage": "staging", "run_id": "run_003", "accuracy": 0.9247},
        }
        self._pipelines = {
            "feature_pipeline": {"id": "feature_pipeline", "name": "Feature Engineering Pipeline", "status": "idle", "last_run": "2026-06-13T22:00:00"},
            "training_pipeline": {"id": "training_pipeline", "name": "Model Training Pipeline", "status": "idle", "last_run": "2026-06-13T18:30:00"},
        }

    def run_experiment(self, name: str, params: dict) -> dict:
        run_id = f"run_{str(uuid.uuid4())[:6]}"
        time.sleep(0.3)
        accuracy = round(random.uniform(0.88, 0.96), 4)
        result = {
            "run_id": run_id,
            "name": name,
            "params": params,
            "metrics": {
                "accuracy": accuracy,
                "loss": round(1 - accuracy + random.uniform(0, 0.05), 4),
                "f1": round(accuracy - random.uniform(0, 0.02), 4),
            },
            "status": "completed",
            "duration_s": random.randint(600, 5000),
        }
        self._experiments[run_id] = result
        return result

    def list_experiments(self, limit: int = 5) -> list[dict]:
        return list(self._experiments.values())[-limit:]

    def get_experiment(self, run_id: str) -> dict:
        return self._experiments.get(run_id, {"error": f"Run {run_id} not found"})

    def register_model(self, run_id: str, model_name: str, stage: str) -> dict:
        exp = self._experiments.get(run_id, {})
        model = {
            "name": model_name,
            "version": str(len(self._models) + 1) + ".0",
            "stage": stage,
            "run_id": run_id,
            "accuracy": exp.get("metrics", {}).get("accuracy", 0),
        }
        self._models[model_name] = model
        return {"registered": True, "model": model}

    def deploy_model(self, model_name: str, version: str, environment: str) -> dict:
        if model_name in self._models:
            self._models[model_name]["stage"] = environment
        return {"deployed": True, "model": model_name, "version": version, "environment": environment, "endpoint": f"https://ml-platform.netflix.internal/{model_name}/v{version}/predict"}

    def get_model_status(self, model_name: str) -> dict:
        return self._models.get(model_name, {"error": f"Model {model_name} not found"})

    def list_models(self) -> list[dict]:
        return list(self._models.values())

    def rollback_model(self, model_name: str, to_version: str) -> dict:
        return {"rolled_back": True, "model": model_name, "version": to_version}

    def trigger_pipeline(self, pipeline_name: str, params: dict) -> dict:
        pipeline_id = f"pipe_{str(uuid.uuid4())[:6]}"
        return {"pipeline_id": pipeline_id, "pipeline_name": pipeline_name, "status": "running", "params": params}

    def get_pipeline_status(self, pipeline_id: str) -> dict:
        return {"pipeline_id": pipeline_id, "status": "completed", "steps_completed": 7, "steps_total": 7}

    def list_pipelines(self) -> list[dict]:
        return list(self._pipelines.values())

    def get_pipeline_logs(self, pipeline_id: str) -> str:
        return f"[INFO] Pipeline {pipeline_id} started\n[INFO] Step 1/7: Data validation passed\n[INFO] Step 2/7: Feature extraction complete\n[INFO] Step 7/7: Pipeline completed successfully"
