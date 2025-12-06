-- Chart Predictoor - Production Database Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#f7931a',
  session_token TEXT UNIQUE NOT NULL, -- Anonymous session identifier
  
  -- Stats
  total_predictions INT DEFAULT 0,
  wins INT DEFAULT 0, -- Times ranked #1
  total_accuracy_sum FLOAT DEFAULT 0, -- Sum of all accuracies for avg calculation
  best_accuracy FLOAT DEFAULT 0,
  current_streak INT DEFAULT 0,
  best_streak INT DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Computed
  avg_accuracy FLOAT GENERATED ALWAYS AS (
    CASE WHEN total_predictions > 0 
    THEN ROUND((total_accuracy_sum / total_predictions)::numeric, 2)
    ELSE 0 END
  ) STORED
);

CREATE INDEX idx_users_session ON users(session_token);
CREATE INDEX idx_users_avg_accuracy ON users(avg_accuracy DESC);

-- ============================================
-- ROUNDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS rounds (
  id BIGSERIAL PRIMARY KEY,
  
  -- Timing (all rounds are 60 seconds)
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  lock_time TIMESTAMPTZ NOT NULL, -- 5 seconds before end, no more submissions
  
  -- Prices (fetched from Binance)
  open_price FLOAT, -- Price at round start
  close_price FLOAT, -- Price at round end (used for scoring)
  high_price FLOAT,
  low_price FLOAT,
  
  -- Status: 'waiting' -> 'active' -> 'locked' -> 'scoring' -> 'completed'
  status TEXT DEFAULT 'waiting',
  
  -- Stats
  player_count INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rounds_status ON rounds(status);
CREATE INDEX idx_rounds_end_time ON rounds(end_time);

-- ============================================
-- PREDICTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- The prediction
  target_price FLOAT NOT NULL,
  
  -- Drawing path (stored as JSON for ghost lines)
  draw_path JSONB, -- Array of {x, y} normalized coordinates
  
  -- Results (filled after round ends)
  accuracy FLOAT,
  rank INT,
  
  -- Timestamps
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One prediction per user per round
  UNIQUE(round_id, user_id)
);

CREATE INDEX idx_predictions_round ON predictions(round_id);
CREATE INDEX idx_predictions_user ON predictions(user_id);
CREATE INDEX idx_predictions_accuracy ON predictions(accuracy DESC);

-- ============================================
-- HOURLY CHALLENGES TABLE (Bonus Feature)
-- ============================================
CREATE TABLE IF NOT EXISTS hourly_challenges (
  id BIGSERIAL PRIMARY KEY,
  hour_timestamp TIMESTAMPTZ NOT NULL UNIQUE, -- The hour this challenge is for
  
  open_price FLOAT,
  close_price FLOAT,
  
  status TEXT DEFAULT 'active', -- 'active' -> 'completed'
  player_count INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hourly_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id BIGINT NOT NULL REFERENCES hourly_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  target_price FLOAT NOT NULL,
  accuracy FLOAT,
  rank INT,
  
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(challenge_id, user_id)
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_predictions ENABLE ROW LEVEL SECURITY;

-- Users: Anyone can read, users can update their own
CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own record" ON users FOR UPDATE USING (true); -- Will validate via function

-- Rounds: Anyone can read
CREATE POLICY "Rounds are viewable by everyone" ON rounds FOR SELECT USING (true);

-- Predictions: Anyone can read (for ghost lines), insert via function only
CREATE POLICY "Predictions are viewable by everyone" ON predictions FOR SELECT USING (true);

-- Hourly: Anyone can read
CREATE POLICY "Hourly challenges viewable by everyone" ON hourly_challenges FOR SELECT USING (true);
CREATE POLICY "Hourly predictions viewable by everyone" ON hourly_predictions FOR SELECT USING (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to get or create user by session token
CREATE OR REPLACE FUNCTION get_or_create_user(
  p_session_token TEXT,
  p_nickname TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_nickname TEXT;
BEGIN
  -- Try to find existing user
  SELECT id INTO v_user_id FROM users WHERE session_token = p_session_token;
  
  IF v_user_id IS NULL THEN
    -- Generate nickname if not provided
    v_nickname := COALESCE(p_nickname, 'Player_' || substr(p_session_token, 1, 6));
    
    -- Create new user
    INSERT INTO users (session_token, nickname)
    VALUES (p_session_token, v_nickname)
    RETURNING id INTO v_user_id;
  ELSE
    -- Update last seen
    UPDATE users SET last_seen_at = NOW() WHERE id = v_user_id;
  END IF;
  
  RETURN v_user_id;
END;
$$;

-- Function to get current active round (or create one)
CREATE OR REPLACE FUNCTION get_current_round()
RETURNS TABLE (
  id BIGINT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  lock_time TIMESTAMPTZ,
  open_price FLOAT,
  status TEXT,
  player_count INT,
  seconds_remaining INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_round RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_round_start TIMESTAMPTZ;
  v_round_end TIMESTAMPTZ;
BEGIN
  -- Find active or waiting round
  SELECT r.* INTO v_round 
  FROM rounds r 
  WHERE r.status IN ('waiting', 'active', 'locked')
  AND r.end_time > v_now
  ORDER BY r.start_time DESC
  LIMIT 1;
  
  -- If no active round, create one
  IF v_round IS NULL THEN
    -- Round starts at next minute boundary
    v_round_start := date_trunc('minute', v_now) + interval '1 minute';
    v_round_end := v_round_start + interval '1 minute';
    
    INSERT INTO rounds (start_time, end_time, lock_time, status)
    VALUES (v_round_start, v_round_end, v_round_end - interval '5 seconds', 'waiting')
    RETURNING * INTO v_round;
  END IF;
  
  -- Return round info
  RETURN QUERY SELECT 
    v_round.id,
    v_round.start_time,
    v_round.end_time,
    v_round.lock_time,
    v_round.open_price,
    v_round.status,
    v_round.player_count,
    GREATEST(0, EXTRACT(EPOCH FROM (v_round.end_time - v_now)))::INT as seconds_remaining;
END;
$$;

-- Function to submit prediction (with validation)
CREATE OR REPLACE FUNCTION submit_prediction(
  p_session_token TEXT,
  p_round_id BIGINT,
  p_target_price FLOAT,
  p_draw_path JSONB DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  prediction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_round RECORD;
  v_prediction_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Get user
  v_user_id := get_or_create_user(p_session_token);
  
  -- Get round and validate
  SELECT * INTO v_round FROM rounds WHERE id = p_round_id;
  
  IF v_round IS NULL THEN
    RETURN QUERY SELECT false, 'Round not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  IF v_round.status NOT IN ('waiting', 'active') THEN
    RETURN QUERY SELECT false, 'Round is locked or completed'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  IF v_now > v_round.lock_time THEN
    RETURN QUERY SELECT false, 'Submissions are locked'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  IF p_target_price <= 0 THEN
    RETURN QUERY SELECT false, 'Invalid target price'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Insert or update prediction
  INSERT INTO predictions (round_id, user_id, target_price, draw_path, submitted_at)
  VALUES (p_round_id, v_user_id, p_target_price, p_draw_path, v_now)
  ON CONFLICT (round_id, user_id) 
  DO UPDATE SET target_price = p_target_price, draw_path = p_draw_path, submitted_at = v_now
  RETURNING id INTO v_prediction_id;
  
  -- Update player count
  UPDATE rounds 
  SET player_count = (SELECT COUNT(DISTINCT user_id) FROM predictions WHERE round_id = p_round_id)
  WHERE id = p_round_id;
  
  RETURN QUERY SELECT true, 'Prediction submitted'::TEXT, v_prediction_id;
END;
$$;

-- Function to score a round (called by Edge Function)
CREATE OR REPLACE FUNCTION score_round(
  p_round_id BIGINT,
  p_close_price FLOAT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prediction RECORD;
  v_rank INT := 0;
  v_accuracy FLOAT;
BEGIN
  -- Update round with close price
  UPDATE rounds 
  SET close_price = p_close_price, status = 'scoring'
  WHERE id = p_round_id;
  
  -- Calculate accuracy for each prediction
  UPDATE predictions p
  SET accuracy = GREATEST(0, 100 - (ABS(p.target_price - p_close_price) / p_close_price * 1000))
  WHERE p.round_id = p_round_id;
  
  -- Assign ranks
  FOR v_prediction IN 
    SELECT id, user_id, accuracy 
    FROM predictions 
    WHERE round_id = p_round_id 
    ORDER BY accuracy DESC
  LOOP
    v_rank := v_rank + 1;
    UPDATE predictions SET rank = v_rank WHERE id = v_prediction.id;
    
    -- Update user stats
    UPDATE users SET
      total_predictions = total_predictions + 1,
      total_accuracy_sum = total_accuracy_sum + v_prediction.accuracy,
      best_accuracy = GREATEST(best_accuracy, v_prediction.accuracy),
      wins = wins + CASE WHEN v_rank = 1 THEN 1 ELSE 0 END,
      current_streak = CASE WHEN v_prediction.accuracy >= 90 THEN current_streak + 1 ELSE 0 END,
      best_streak = GREATEST(best_streak, CASE WHEN v_prediction.accuracy >= 90 THEN current_streak + 1 ELSE current_streak END)
    WHERE id = v_prediction.user_id;
  END LOOP;
  
  -- Mark round as completed
  UPDATE rounds SET status = 'completed' WHERE id = p_round_id;
  
  RETURN true;
END;
$$;

-- Function to get leaderboard
CREATE OR REPLACE FUNCTION get_leaderboard(p_limit INT DEFAULT 20)
RETURNS TABLE (
  rank BIGINT,
  user_id UUID,
  nickname TEXT,
  avatar_color TEXT,
  total_predictions INT,
  avg_accuracy FLOAT,
  best_accuracy FLOAT,
  wins INT,
  current_streak INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROW_NUMBER() OVER (ORDER BY u.avg_accuracy DESC, u.total_predictions DESC) as rank,
    u.id as user_id,
    u.nickname,
    u.avatar_color,
    u.total_predictions,
    u.avg_accuracy,
    u.best_accuracy,
    u.wins,
    u.current_streak
  FROM users u
  WHERE u.total_predictions > 0
  ORDER BY u.avg_accuracy DESC, u.total_predictions DESC
  LIMIT p_limit;
END;
$$;

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================
-- Enable realtime for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE predictions;

-- ============================================
-- CRON JOB (Run in Supabase Dashboard > SQL Editor)
-- Creates new round every minute
-- ============================================
-- SELECT cron.schedule(
--   'create-rounds',
--   '* * * * *', -- Every minute
--   $$
--   SELECT get_current_round();
--   $$
-- );

