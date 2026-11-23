CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE scenes (
  id TEXT PRIMARY KEY NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('builtin', 'custom')),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  scope TEXT NOT NULL,
  english_title TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('hotel', 'airport', 'food', 'bus', 'generic')),
  course_source TEXT,
  course_generated_at TEXT,
  course_planning_call_json TEXT CHECK (course_planning_call_json IS NULL OR json_valid(course_planning_call_json)),
  CHECK (
    (course_source IS NULL AND course_generated_at IS NULL AND course_planning_call_json IS NULL)
    OR
    (course_source IS NOT NULL AND course_source = 'generated' AND course_generated_at IS NOT NULL AND course_planning_call_json IS NOT NULL)
  )
) STRICT;

CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  onboarding_completed_at TEXT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'advanced')),
  last_scene_id TEXT REFERENCES scenes(id)
) STRICT;

CREATE TABLE scene_topics (
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  topic_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  boundaries TEXT NOT NULL,
  PRIMARY KEY (scene_id, topic_id),
  UNIQUE (scene_id, position)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  scene_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'practice'),
  status TEXT NOT NULL CHECK (status IN ('active', 'awaiting_continue', 'topic_completed')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  current_question_id TEXT,
  config_snapshot_json TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
  plan_snapshot_json TEXT NOT NULL CHECK (json_valid(plan_snapshot_json)),
  planning_call_json TEXT NOT NULL CHECK (json_valid(planning_call_json)),
  pending_continuation_json TEXT CHECK (pending_continuation_json IS NULL OR json_valid(pending_continuation_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  topic_completed_at TEXT,
  FOREIGN KEY (scene_id, topic_id) REFERENCES scene_topics(scene_id, topic_id),
  CHECK (
    (status = 'topic_completed' AND current_question_id IS NULL AND topic_completed_at IS NOT NULL AND pending_continuation_json IS NULL)
    OR
    (status != 'topic_completed' AND current_question_id IS NOT NULL AND topic_completed_at IS NULL)
  ),
  CHECK ((status = 'awaiting_continue') = (pending_continuation_json IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX sessions_one_active_scene ON sessions(scene_id)
  WHERE status IN ('active', 'awaiting_continue');
CREATE INDEX sessions_scene_updated ON sessions(scene_id, updated_at DESC, id);
CREATE INDEX sessions_topic_status ON sessions(scene_id, topic_id, status);

CREATE TABLE turns (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  action TEXT NOT NULL CHECK (action IN ('question', 'answer', 'hint', 'explain', 'completed')),
  question_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE (session_id, sequence),
  CHECK ((action = 'completed') = (question_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX turns_question ON turns(session_id, question_id) WHERE action = 'question';
CREATE UNIQUE INDEX turns_completed ON turns(session_id) WHERE action = 'completed';
CREATE INDEX turns_question_action ON turns(session_id, question_id, action);

CREATE TABLE operation_receipts (
  operation TEXT NOT NULL CHECK (operation IN ('initialize-scene', 'create-session', 'session-turn', 'create-scene')),
  scope_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64 AND input_hash NOT GLOB '*[^a-f0-9]*'),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT,
  PRIMARY KEY (operation, scope_id, request_id),
  CHECK (created_at IS NOT NULL OR operation = 'create-session')
) STRICT;
