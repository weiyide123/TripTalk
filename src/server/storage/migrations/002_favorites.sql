CREATE TABLE favorites (
  id TEXT PRIMARY KEY NOT NULL,
  source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  source_part TEXT NOT NULL CHECK (source_part IN ('question', 'roleplay', 'corrected_answer', 'closing')),
  scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  topic_id TEXT NOT NULL,
  scene_title TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  english TEXT NOT NULL CHECK (length(trim(english)) > 0),
  chinese_translation TEXT,
  explanation TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_turn_id, source_part)
) STRICT;
CREATE INDEX favorites_created ON favorites(created_at DESC, id DESC);
CREATE INDEX favorites_scene_topic ON favorites(scene_id, topic_id, created_at DESC, id DESC);
