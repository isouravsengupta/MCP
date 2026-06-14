"""
Creates and seeds the local SQLite database that replaces the mock platform.
This simulates Netflix's internal ML metadata store.

Tables:
  experiments  — training runs with hyperparams and metrics
  models       — registered models and deployment status
  pipelines    — ML pipeline definitions and run history
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "mlctl.db")


SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    run_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    model_type      TEXT,
    lr              REAL,
    epochs          INTEGER,
    batch_size      INTEGER,
    accuracy        REAL,
    loss            REAL,
    f1              REAL,
    status          TEXT DEFAULT 'completed',
    duration_s      INTEGER,
    created_by      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
    model_id        TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    version         TEXT,
    stage           TEXT DEFAULT 'staging',
    run_id          TEXT,
    accuracy        REAL,
    endpoint        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(run_id) REFERENCES experiments(run_id)
);

CREATE TABLE IF NOT EXISTS pipelines (
    pipeline_id     TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    status          TEXT DEFAULT 'idle',
    last_run_at     TEXT,
    steps_total     INTEGER DEFAULT 7,
    steps_completed INTEGER DEFAULT 0,
    owner           TEXT
);
"""

SEED_DATA = """
INSERT OR IGNORE INTO experiments VALUES
  ('run_001','baseline_recommender','two-tower',0.01,10,64,0.8821,0.3412,0.871,'completed',1820,'ml-team','2026-06-01 10:00:00'),
  ('run_002','tuned_recommender','two-tower',0.001,15,128,0.9103,0.2891,0.902,'completed',2640,'ml-team','2026-06-05 14:30:00'),
  ('run_003','deep_recommender','transformer',0.0005,20,256,0.9247,0.2541,0.919,'completed',4210,'ml-team','2026-06-08 09:15:00'),
  ('run_004','attention_recommender','transformer',0.0003,25,512,0.9312,0.2401,0.928,'completed',5100,'ml-team','2026-06-10 11:00:00'),
  ('run_005','fast_recommender','two-tower',0.005,8,64,0.8654,0.3701,0.851,'completed',980,'ml-team','2026-06-11 16:45:00'),
  ('run_006','experimental_v1','bert-finetune',0.00001,3,32,0.7821,0.4812,0.771,'failed',310,'research-team','2026-06-12 08:00:00'),
  ('run_007','experimental_v2','bert-finetune',0.0001,5,32,0.8901,0.3102,0.881,'completed',890,'research-team','2026-06-13 10:30:00');

INSERT OR IGNORE INTO models VALUES
  ('model_001','recommender_v1','1.0','production','run_001',0.8821,'https://ml-platform.netflix.internal/recommender_v1/v1.0/predict','2026-06-03 12:00:00'),
  ('model_002','recommender_v2','2.0','staging','run_003',0.9247,'https://ml-platform.netflix.internal/recommender_v2/v2.0/predict','2026-06-09 14:00:00'),
  ('model_003','fast_ranker','1.0','staging','run_005',0.8654,'https://ml-platform.netflix.internal/fast_ranker/v1.0/predict','2026-06-12 10:00:00');

INSERT OR IGNORE INTO pipelines VALUES
  ('pipe_001','feature_engineering_pipeline','idle','2026-06-13 22:00:00',7,7,'data-eng'),
  ('pipe_002','model_training_pipeline','idle','2026-06-13 18:30:00',10,10,'ml-team'),
  ('pipe_003','model_evaluation_pipeline','idle','2026-06-13 19:00:00',5,5,'ml-team'),
  ('pipe_004','data_validation_pipeline','running','2026-06-14 08:00:00',4,2,'data-eng');
"""


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.executescript(SEED_DATA)
    conn.commit()
    conn.close()
    print(f"Database initialised at {DB_PATH}")


if __name__ == "__main__":
    init_db()
