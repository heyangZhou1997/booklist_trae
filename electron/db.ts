import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

// Ensure we don't try to access app before it's ready if imported at top level
// But dbPath needs app.getPath which is available after app 'ready' usually? 
// Actually app.getPath('userData') is available early? 
// Safer to initialize in a function or after ready.
// However, standard practice:
// const dbPath = path.join(app.getPath('userData'), 'booklist.db')

let db: Database.Database

export function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'booklist.db')
  db = new Database(dbPath)
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      isbn TEXT UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      translator TEXT,
      publisher TEXT,
      list_price DECIMAL(10,2),
      cover_url TEXT,
      description TEXT,
      publish_year INTEGER,
      page_count INTEGER,
      status TEXT CHECK (status IN ('unpurchased', 'reading', 'finished')) DEFAULT 'unpurchased',
      purchase_date DATE,
      start_reading_date DATE,
      finish_reading_date DATE,
      reading_progress INTEGER DEFAULT 0 CHECK (reading_progress >= 0 AND reading_progress <= 100),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS series_books (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      UNIQUE(series_id, book_id)
    );

    CREATE INDEX IF NOT EXISTS idx_series_books_series ON series_books(series_id);

    CREATE TABLE IF NOT EXISTS price_history (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      original_price DECIMAL(10,2),
      discount_rate DECIMAL(5,2),
      in_stock BOOLEAN DEFAULT true,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_book ON price_history(book_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_fetched ON price_history(fetched_at DESC);
  `)
  
    // Add translator column if not exists (for migration)
    try {
        db.exec("ALTER TABLE books ADD COLUMN translator TEXT");
    } catch (e) {
        // Column already exists, ignore
    }

    try {
      db.exec("ALTER TABLE books ADD COLUMN jd_sku TEXT");
    } catch (e) {
      // ignore
    }

    try {
      db.exec("ALTER TABLE books ADD COLUMN jd_url TEXT");
    } catch (e) {
      // ignore
    }

    try {
      db.exec("ALTER TABLE books ADD COLUMN list_price DECIMAL(10,2)");
    } catch (e) {
      // ignore
    }
  
  return db
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}
