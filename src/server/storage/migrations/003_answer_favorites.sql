-- 只扩展收藏来源类型；原记录、UUID、时间与外键关系全部保留。
CREATE TABLE favorites_new (
  id TEXT PRIMARY KEY NOT NULL,
  source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  source_part TEXT NOT NULL CHECK (source_part IN ('question', 'roleplay', 'corrected_answer', 'closing', 'learner_answer')),
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
INSERT INTO favorites_new SELECT * FROM favorites ORDER BY rowid;
DROP TABLE favorites;
ALTER TABLE favorites_new RENAME TO favorites;
CREATE INDEX favorites_created ON favorites(created_at DESC, id DESC);
CREATE INDEX favorites_scene_topic ON favorites(scene_id, topic_id, created_at DESC, id DESC);

-- 历史补译是派生缓存，不改写不可变 turns，也不推进 sessions.revision。
CREATE TABLE turn_translations (
  source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  source_part TEXT NOT NULL CHECK (source_part IN ('question', 'roleplay', 'corrected_answer', 'closing', 'learner_answer')),
  chinese_translation TEXT NOT NULL CHECK (length(trim(chinese_translation)) BETWEEN 1 AND 3000),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_turn_id, source_part)
) STRICT;
