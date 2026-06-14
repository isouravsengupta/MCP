import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from db.query_engine import get_pipelines
from mock.platform_mock import MockPlatform

_mock = MockPlatform()


class PipelineTools:
    def __init__(self, platform=None):
        self.platform = platform or _mock

    def trigger_pipeline(self, pipeline_name: str, params: dict = None) -> dict:
        return self.platform.trigger_pipeline(pipeline_name, params or {})

    def get_pipeline_status(self, pipeline_id: str) -> dict:
        return self.platform.get_pipeline_status(pipeline_id)

    def list_pipelines(self) -> list[dict]:
        return get_pipelines()

    def get_pipeline_logs(self, pipeline_id: str) -> str:
        return self.platform.get_pipeline_logs(pipeline_id)
