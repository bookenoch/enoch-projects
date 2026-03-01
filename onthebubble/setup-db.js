const Database = require('better-sqlite3');
const db = new Database('./data/onthebubble.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    gender TEXT,
    ntrp REAL,
    dynamic_rating REAL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    district TEXT,
    section TEXT,
    bubble_status TEXT,
    team TEXT,
    league TEXT
  )
`);

// Migrate existing DBs that predate team/league columns
try { db.exec('ALTER TABLE players ADD COLUMN team TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE players ADD COLUMN league TEXT'); } catch(e) {}

console.log('Database created successfully');
db.close();
