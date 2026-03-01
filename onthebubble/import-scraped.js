/**
 * import-scraped.js
 *
 * Imports scraped JSON into SQLite.
 * Usage: node import-scraped.js [data-file.json]
 * Default: data/neota-scraped.json
 *
 * - Replaces only the teams present in the scraped file (leaves others untouched)
 * - Replaces only the matches present in the scraped file
 */

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const dataFile = process.argv[2] || path.join(__dirname, 'data/neota-scraped.json');
console.log(`Reading: ${dataFile}`);

const db      = new Database('./data/onthebubble.db');
const scraped = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const statsFile = path.join(__dirname, 'data/player-stats-scraped.json');
const playerStats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};

// Support both old array format and new { teams, matches } format
const teams   = Array.isArray(scraped) ? scraped : scraped.teams  || [];
const matches = Array.isArray(scraped) ? []       : scraped.matches || [];

// ── Ensure schema ──────────────────────────────────────────────────────────────
try { db.exec('ALTER TABLE players ADD COLUMN team TEXT');       } catch(e) {}
try { db.exec('ALTER TABLE players ADD COLUMN league TEXT');     } catch(e) {}
try { db.exec('ALTER TABLE players ADD COLUMN stats_json TEXT'); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    match_id       INTEGER PRIMARY KEY,
    date           TEXT,
    home_team      TEXT,
    away_team      TEXT,
    home_courts_won INTEGER DEFAULT 0,
    away_courts_won INTEGER DEFAULT 0,
    venue          TEXT,
    league         TEXT,
    year           TEXT
  );
  CREATE TABLE IF NOT EXISTS match_courts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id     INTEGER,
    court_number INTEGER,
    home_player1 TEXT,
    home_player2 TEXT,
    home_rating1 REAL,
    home_rating2 REAL,
    away_player1 TEXT,
    away_player2 TEXT,
    away_rating1 REAL,
    away_rating2 REAL,
    score        TEXT,
    winner       TEXT
  );
`);

// ── Prepared statements ────────────────────────────────────────────────────────
// Delete exact team match OR rows whose merged team field contains this team name
const deleteTeam   = db.prepare("DELETE FROM players WHERE team = ? OR team LIKE '%' || ? || '%'");
const insertPlayer = db.prepare(`
  INSERT INTO players
    (name, location, gender, ntrp, dynamic_rating, wins, losses, district, section, bubble_status, team, league, stats_json)
  VALUES
    (@name, @location, @gender, @ntrp, @dynamic_rating, @wins, @losses, @district, @section, @bubble_status, @team, @league, @stats_json)
`);

const deleteMatch  = db.prepare('DELETE FROM matches WHERE match_id = ?');
const deleteCourts = db.prepare('DELETE FROM match_courts WHERE match_id = ?');
const insertMatch  = db.prepare(`
  INSERT OR REPLACE INTO matches (match_id, date, home_team, away_team, home_courts_won, away_courts_won, venue, league, year)
  VALUES (@match_id, @date, @home_team, @away_team, @home_courts_won, @away_courts_won, @venue, @league, @year)
`);
const insertCourt  = db.prepare(`
  INSERT INTO match_courts
    (match_id, court_number, home_player1, home_player2, home_rating1, home_rating2,
     away_player1, away_player2, away_rating1, away_rating2, score, winner)
  VALUES
    (@match_id, @court_number, @home_player1, @home_player2, @home_rating1, @home_rating2,
     @away_player1, @away_player2, @away_rating1, @away_rating2, @score, @winner)
`);

// ── Import ────────────────────────────────────────────────────────────────────
const importAll = db.transaction(() => {
  let playersTotal = 0;

  // Players
  for (const team of teams) {
    const districtMatch = team.leagueName.match(/NEOTA|SWOTA|COTA|NWOTA/i);
    const district      = districtMatch ? districtMatch[0].toUpperCase() : 'NEOTA';
    const deleted       = deleteTeam.run(team.teamName, team.teamName);

    for (const p of team.players) {
      const stats2025 = playerStats[p.name] || null;
      insertPlayer.run({
        name:           p.name,
        location:       p.location      || null,
        gender:         p.gender        || null,
        ntrp:           p.ntrp          ?? null,
        dynamic_rating: p.dynamicRating ?? null,
        wins:           p.wins          ?? 0,
        losses:         p.losses        ?? 0,
        district,
        section:        team.section    || 'Midwest',
        bubble_status:  p.bubbleStatus  || 'safe',
        team:           team.teamName,
        league:         team.leagueName,
        stats_json:     stats2025 ? JSON.stringify(stats2025) : null,
      });
    }
    console.log(`  ${team.teamName}: removed ${deleted.changes} old rows, inserted ${team.players.length}`);
    playersTotal += team.players.length;
  }

  // Matches
  for (const m of matches) {
    deleteMatch.run(m.matchId);
    deleteCourts.run(m.matchId);
    insertMatch.run({
      match_id:        m.matchId,
      date:            m.date,
      home_team:       m.homeTeam,
      away_team:       m.awayTeam,
      home_courts_won: m.homeCourtsWon,
      away_courts_won: m.awayCourtsWon,
      venue:           m.venue,
      league:          m.league,
      year:            m.date ? m.date.split('/').pop() : '2025',
    });
    for (const c of m.courts) {
      insertCourt.run({
        match_id:     m.matchId,
        court_number: c.courtNumber,
        home_player1: c.home_player1,
        home_player2: c.home_player2,
        home_rating1: c.home_rating1,
        home_rating2: c.home_rating2,
        away_player1: c.away_player1,
        away_player2: c.away_player2,
        away_rating1: c.away_rating1,
        away_rating2: c.away_rating2,
        score:        c.score,
        winner:       c.winner,
      });
    }
  }

  return playersTotal;
});

// ── Dedup: merge same-name same-league players ──────────────────────────────
const dedup = db.transaction(() => {
  const dupes = db.prepare(`
    SELECT name, league, COUNT(*) as cnt
    FROM players GROUP BY name, league HAVING cnt > 1
  `).all();

  let merged = 0;
  for (const { name, league } of dupes) {
    const rows = db.prepare(
      'SELECT * FROM players WHERE name = ? AND league = ? ORDER BY (wins + losses) DESC, stats_json IS NOT NULL DESC, id ASC'
    ).all(name, league);

    // Keep the first row (best record / has stats), merge team names from the rest
    const keep    = rows[0];
    const others  = rows.slice(1);
    const allTeams = rows.flatMap(r => r.team.split(' / '));
    const mergedTeam = [...new Set(allTeams)].join(' / ');

    db.prepare('UPDATE players SET team = ? WHERE id = ?').run(mergedTeam, keep.id);
    for (const dup of others) {
      db.prepare('DELETE FROM players WHERE id = ?').run(dup.id);
    }
    console.log(`  Dedup: merged ${rows.length} rows for "${name}" in ${league} → teams: ${mergedTeam}`);
    merged += others.length;
  }
  return merged;
});

console.log('Importing scraped NEOTA data...\n');
const total = importAll();

console.log('\nChecking for same-league duplicates...');
const dedupCount = dedup();
if (dedupCount > 0) {
  console.log(`Merged ${dedupCount} duplicate player rows.`);
} else {
  console.log('No duplicates found.');
}

const teamCounts  = db.prepare('SELECT team, COUNT(*) as n FROM players GROUP BY team ORDER BY team').all();
const matchCount  = db.prepare('SELECT COUNT(*) as n FROM matches').get();
const courtCount  = db.prepare('SELECT COUNT(*) as n FROM match_courts').get();

console.log(`\nDone. ${total} players imported | ${dedupCount} dupes merged | ${matches.length} matches | ${courtCount.n} court records`);
console.log('\nCurrent DB:\n' + teamCounts.map(r => `  ${r.team}: ${r.n} players`).join('\n'));

db.close();
