const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const { expandFirstNames } = require('./nicknames');

const app = express();
const db = new Database('./data/onthebubble.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function parsePlayer(p) {
  if (p && p.stats_json) {
    try { p.stats = JSON.parse(p.stats_json); } catch(e) {}
    delete p.stats_json;
  }
  return p;
}

// Aggregate multiple DB rows for the same player into one unified view
function aggregateRows(rows) {
  if (!rows || rows.length === 0) return null;
  rows = rows.map(parsePlayer);

  const currentYear = new Date().getFullYear().toString();
  const isCurrent = r => (r.league || '').startsWith(currentYear);

  if (rows.length === 1) {
    const r = rows[0];
    r.current_wins = isCurrent(r) ? (r.wins || 0) : 0;
    r.current_losses = isCurrent(r) ? (r.losses || 0) : 0;
    return r;
  }

  const base = { ...rows[0] };

  // Highest dynamic rating
  const ratings = rows.map(r => r.dynamic_rating).filter(Boolean);
  base.dynamic_rating = ratings.length ? Math.max(...ratings) : null;

  // Max NTRP (shouldn't vary, but be safe)
  const ntrps = rows.map(r => r.ntrp).filter(Boolean);
  base.ntrp = ntrps.length ? Math.max(...ntrps) : null;

  // Sum wins/losses across all leagues
  base.wins = rows.reduce((sum, r) => sum + (r.wins || 0), 0);
  base.losses = rows.reduce((sum, r) => sum + (r.losses || 0), 0);

  // Current season wins/losses (only rows from current year)
  const currentRows = rows.filter(isCurrent);
  base.current_wins = currentRows.reduce((sum, r) => sum + (r.wins || 0), 0);
  base.current_losses = currentRows.reduce((sum, r) => sum + (r.losses || 0), 0);

  // Combine teams and leagues
  const allTeams = rows.flatMap(r => (r.team || '').split(' / ')).filter(Boolean);
  base.team = [...new Set(allTeams)].join(' / ');
  base.league = [...new Set(rows.map(r => r.league).filter(Boolean))].join(' / ');

  // First non-null for other fields
  base.location = rows.find(r => r.location)?.location || null;
  base.gender = rows.find(r => r.gender)?.gender || null;
  base.district = rows.find(r => r.district)?.district || null;
  base.section = rows.find(r => r.section)?.section || null;

  // Take the richest stats object
  const withStats = rows.filter(r => r.stats);
  if (withStats.length > 0) {
    base.stats = withStats.sort((a, b) =>
      Object.keys(b.stats || {}).length - Object.keys(a.stats || {}).length
    )[0].stats;
  }

  // Recalculate bubble_status from aggregated rating
  // Band: floor (ntrp - 0.5) to ceiling (ntrp). Risk within 0.05 of either edge.
  if (base.ntrp && base.dynamic_rating) {
    const ceiling = base.ntrp;
    const floor   = base.ntrp - 0.5;
    if (base.dynamic_rating >= ceiling - 0.05) base.bubble_status = 'risk';
    else if (base.dynamic_rating <= floor + 0.05) base.bubble_status = 'risk_down';
    else base.bubble_status = 'safe';
  }

  return base;
}

// Search players (aggregated — one result per player name)
app.get('/api/players/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const parts = q.split(/\s+/);
  let rows;

  if (parts.length >= 2) {
    // Multi-word: last token = last name, rest = first name
    const firstInput = parts.slice(0, -1).join(' ');
    const lastInput  = parts[parts.length - 1];

    // Find all players matching last name
    const lastNameRows = db.prepare(`
      SELECT * FROM players
      WHERE name LIKE ?
      ORDER BY dynamic_rating DESC
    `).all(`% ${lastInput}%`);

    // Expand first name via nickname map
    const expanded = expandFirstNames(firstInput).map(n => n.toLowerCase());

    // Filter: player's first name must match an expanded variant
    rows = lastNameRows.filter(r => {
      const playerFirst = r.name.split(' ')[0].toLowerCase();
      return expanded.some(n => playerFirst.startsWith(n) || n.startsWith(playerFirst));
    });

    // Also run original LIKE as fallback, merge + deduplicate
    const fallback = db.prepare(`
      SELECT * FROM players
      WHERE name LIKE ?
      ORDER BY dynamic_rating DESC
    `).all(`%${q}%`);
    const seen = new Set(rows.map(r => r.id));
    for (const r of fallback) {
      if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
    }
  } else {
    // Single-word: keep existing LIKE behavior
    rows = db.prepare(`
      SELECT * FROM players
      WHERE name LIKE ?
      ORDER BY dynamic_rating DESC
    `).all(`%${q}%`);
  }

  // Group by name and aggregate
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.name)) grouped.set(r.name, []);
    grouped.get(r.name).push(r);
  }
  const players = [...grouped.values()].map(aggregateRows).filter(Boolean);
  res.json(players);
});

// Get players by team
app.get('/api/players/team', (req, res) => {
  const { team } = req.query;
  const players = db.prepare(`
    SELECT * FROM players
    WHERE team = ?
    ORDER BY dynamic_rating DESC
  `).all(team || '').map(parsePlayer);
  res.json(players);
});

// Get matches for a team (with court-by-court detail)
app.get('/api/matches/team', (req, res) => {
  const { team } = req.query;
  const matches = db.prepare(`
    SELECT * FROM matches
    WHERE home_team = ? OR away_team = ?
    ORDER BY date DESC
  `).all(team, team);

  for (const m of matches) {
    m.courts = db.prepare(`
      SELECT * FROM match_courts WHERE match_id = ? ORDER BY court_number
    `).all(m.match_id);
  }

  res.json(matches);
});

// Get recent court appearances for a player (for player card recent matches section)
app.get('/api/players/courts', (req, res) => {
  const { name } = req.query;
  if (!name) return res.json([]);

  const rows = db.prepare(`
    SELECT mc.*, m.date, m.home_team, m.away_team, m.league
    FROM match_courts mc
    JOIN matches m ON mc.match_id = m.match_id
    WHERE mc.home_player1 = ? OR mc.home_player2 = ?
       OR mc.away_player1 = ? OR mc.away_player2 = ?
    ORDER BY m.date DESC
  `).all(name, name, name, name);

  res.json(rows);
});

// Get aggregated player profile by name (unified across leagues)
app.get('/api/players/profile', (req, res) => {
  const { name } = req.query;
  if (!name) return res.json(null);
  const rows = db.prepare('SELECT * FROM players WHERE name = ?').all(name);
  res.json(aggregateRows(rows));
});

// Get single player by id
app.get('/api/players/:id', (req, res) => {
  const player = db.prepare(`
    SELECT * FROM players WHERE id = ?
  `).get(req.params.id);
  res.json(parsePlayer(player));
});

app.listen(3000, () => {
  console.log('OnTheBubble running on http://localhost:3000');
});
