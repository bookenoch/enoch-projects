const Database = require('better-sqlite3');
const db = new Database('./data/onthebubble.db');

// Create table if not already created
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

// Clear existing data before re-seeding
db.exec('DELETE FROM players');

// seed-db.js is now superseded by import-scraped.js (live data from TennisRecord.com)
// Run `node import-scraped.js` after `node scraper/scrape-neota.js` to refresh data.
console.log('Note: use `node scraper/scrape-neota.js && node import-scraped.js` to seed from live data.');
db.close();
