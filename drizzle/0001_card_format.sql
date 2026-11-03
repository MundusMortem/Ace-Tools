ALTER TABLE cards ADD COLUMN format TEXT NOT NULL DEFAULT 'number' CHECK (format IN ('number', 'percent', 'dollars'));
