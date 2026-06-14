import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from db.query_engine import get_experiments, get_experiment_by_id, compare_experiments


class ExperimentTools:
    def __init__(self, platform=None):
        # platform kept for backwards compat but DB is the real source now
        self.platform = platform

    def run_experiment(self, name: str, params: dict) -> dict:
        # still uses mock for triggering — real version would call Metaflow API
        return self.platform.run_experiment(name, params)

    def list_experiments(self, limit: int = 5) -> list[dict]:
        return get_experiments(limit=limit)

    def get_experiment(self, run_id: str) -> dict:
        return get_experiment_by_id(run_id)

    def compare_runs(self, run_ids: list[str]) -> dict:
        return compare_experiments(run_ids)
