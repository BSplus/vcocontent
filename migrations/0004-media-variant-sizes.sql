-- The total stored_bytes remains the sum of both persisted variants.
-- Historical records remain NULL until their sizes are independently verified.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS high_bytes bigint;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS low_bytes bigint;