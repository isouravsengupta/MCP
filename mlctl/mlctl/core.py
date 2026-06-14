from dataclasses import dataclass, field
from typing import Optional
import time


@dataclass
class EvalCase:
    name: str
    input: str
    tags: list[str] = field(default_factory=list)
    expected_keywords: list[str] = field(default_factory=list)
    forbidden_keywords: list[str] = field(default_factory=list)
    max_length: Optional[int] = None


@dataclass
class EvalResult:
    eval_name: str
    passed: bool
    output: str
    reason: str
    latency_ms: float
    model: str
    run_id: str
    timestamp: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%S"))
