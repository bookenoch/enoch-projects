/**
 * scrape-mixed80.js
 *
 * Phase 1 — Teams: start from seed, follow opponent links, parse rosters.
 * Phase 2 — Matches: collect match IDs from each team's schedule, fetch
 *            court-by-court results for every played match.
 *
 * Output: data/mixed80-scraped.json  { teams: [...], matches: [...] }
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE     = 'https://www.tennisrecord.com';
const YEAR     = '2026';
const DELAY_MS = 700;
const OUT_FILE = path.join(__dirname, '../data/mixed80-scraped.json');
const SEED_URLS = [
  `/adult/teamprofile.aspx?year=${YEAR}&teamname=X40%208.0%20LT%20Banas`,
  `/adult/teamprofile.aspx?year=${YEAR}&teamname=X40%208.0%20MM%20Rhyner`,
  `/adult/teamprofile.aspx?year=${YEAR}&teamname=X40%208.0%20MV1%20Smith`,
  `/adult/teamprofile.aspx?year=${YEAR}&teamname=X40%208.0%20MV2%20Zalba`,
  `/adult/teamprofile.aspx?year=${YEAR}&teamname=X40%208.0%20PW%20Weiss`,
];

const agent   = new https.Agent({ rejectUnauthorized: false });
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url) {
  const r = await axios.get(url, { httpsAgent: agent, headers, timeout: 15000 });
  return cheerio.load(r.data);
}

function parseRecord(str) {
  const [w, l] = (str || '').split('-').map(n => parseInt(n));
  return { wins: isNaN(w) ? 0 : w, losses: isNaN(l) ? 0 : l };
}

function bubbleStatus(ntrp, rating) {
  if (!ntrp || !rating) return 'safe';
  const ceiling = ntrp;
  const floor   = ntrp - 0.5;
  if (rating >= ceiling - 0.05) return 'risk';
  if (rating <= floor   + 0.05) return 'risk_down';
  return 'safe';
}

function teamKey(url) {
  const m = url.match(/teamname=([^&]+)/i);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).toLowerCase().trim() : url;
}

function normaliseTeamUrl(href) {
  let url = href.replace(/ /g, '%20');
  if (!url.includes('year=')) url = `${url}${url.includes('?') ? '&' : '?'}year=${YEAR}`;
  return url;
}

// ── Team profile scraper ───────────────────────────────────────────────────────
async function scrapeTeamProfile(url) {
  let $;
  try {
    $ = await fetchPage(BASE + url);
  } catch (e) {
    console.error(`  ✗ fetch error: ${e.message}`);
    return null;
  }

  // ── Info table ───────────────────────────────────────────────────────────
  let leagueType = '', leagueName = '', section = '', gender = '', level = '', teamName = '';

  $('table').each((i, tbl) => {
    if (leagueType) return;
    const rows = $(tbl).find('tr');
    if (rows.length < 3) return;
    const r0 = $(rows.eq(0)).find('td').first().text().trim();
    const r1 = $(rows.eq(1)).find('td').first().text().trim();
    const r2 = $(rows.eq(2)).find('td').first().text().trim();
    if (/Mixed|Adult|Combo|Tri-Level/i.test(r0) && r0.length < 80) {
      const m = r0.match(/^(Mixed \d+\+|Adult|Combo|Tri-Level)\s+(\S+)\s+(\S+)\s+(\S+)/i);
      if (m) { leagueType = m[1]; section = m[2]; gender = m[3]; level = m[4]; }
      else    { leagueType = r0; }
      leagueName = r1;
      teamName   = r2;
    }
  });

  if (!teamName) {
    const m = url.match(/teamname=([^&]+)/);
    if (m) teamName = decodeURIComponent(m[1]);
  }

  // Only accept Mixed 40+ 8.0 teams
  if (!leagueType.toLowerCase().includes('mixed') || !leagueType.includes('40') || !level.includes('8.0')) return null;

  // ── Roster ───────────────────────────────────────────────────────────────
  const players = [];
  let rosterFound = false;

  $('table').each((i, tbl) => {
    if (rosterFound) return;
    const headerRow  = $(tbl).find('tr').first();
    const headerText = headerRow.text().replace(/\s+/g, ' ').trim();
    if (!headerText.includes('Name') || !headerText.includes('NTRP') || !headerText.includes('Rating')) return;
    const colCount = headerRow.find('th, td').length;
    if (colCount < 6) return;
    rosterFound = true;

    $(tbl).find('tr').slice(1).each((j, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 6) return;
      const name    = $(cells.eq(0)).text().trim();
      const loc     = $(cells.eq(1)).text().trim();
      const ntrpRaw = parseFloat($(cells.eq(2)).text().trim());
      const ntrp    = isNaN(ntrpRaw) ? null : ntrpRaw;
      if (!name || !ntrp) return;
      const genderVal = $(cells.eq(3)).text().trim();
      const rec       = parseRecord($(cells.eq(4)).text().trim());
      const dynRaw    = parseFloat($(cells.eq(colCount - 1)).text().trim());
      const rating    = isNaN(dynRaw) ? null : dynRaw;
      players.push({
        name, location: loc, gender: genderVal || null, ntrp,
        wins: rec.wins, losses: rec.losses,
        dynamicRating: rating, bubbleStatus: bubbleStatus(ntrp, rating),
      });
    });
  });

  // ── Schedule (opponent links + match IDs) ─────────────────────────────────
  const opponentUrls = new Set();
  const schedule     = [];

  $('table').each((i, tbl) => {
    const headerText = $(tbl).find('tr').first().text().replace(/\s+/g, ' ').trim();
    if (!headerText.includes('Local Schedule') || !headerText.includes('Result')) return;

    $(tbl).find('tr').slice(1).each((j, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 5) return;

      const date     = $(cells.eq(0)).text().trim();
      const opponent = $(cells.eq(2)).text().trim();
      const venue    = $(cells.eq(3)).text().trim();
      const result   = $(cells.eq(4)).text().trim();

      const oppHref = $(tr).find('a[href*="teamprofile"]').attr('href') || '';
      if (oppHref) opponentUrls.add(normaliseTeamUrl(oppHref));

      const matchHref = $(tr).find('a[href*="matchresults"]').attr('href') || '';
      const midMatch  = matchHref.match(/mid=(\d+)/);
      const matchId   = midMatch ? parseInt(midMatch[1]) : null;

      schedule.push({ date, opponent, venue, result, matchId });
    });
  });

  const filtered = [...opponentUrls].filter(h => {
    try {
      const m = h.match(/teamname=([^&]+)/);
      return !m || decodeURIComponent(m[1]) !== teamName;
    } catch { return true; }
  });

  return { url, teamName, leagueName, leagueType, section, gender, level, players, opponentUrls: filtered, schedule };
}

// ── Match result scraper ───────────────────────────────────────────────────────
async function scrapeMatchResult(mid) {
  let $;
  try {
    $ = await fetchPage(`${BASE}/adult/matchresults.aspx?year=${YEAR}&mid=${mid}`);
  } catch (e) {
    console.error(`  ✗ match fetch error (mid=${mid}): ${e.message}`);
    return null;
  }

  let date = '', venue = '', league = '';
  $('table').eq(1).find('tr').each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 1) { league = $(cells.eq(0)).text().trim(); }
    else if (cells.length >= 2) {
      const label = $(cells.eq(0)).text().trim();
      const val   = $(cells.eq(1)).text().trim();
      if (label === 'Scheduled Date:') date  = val;
      if (label === 'Match Site:')     venue = val;
    }
  });

  let homeTeam = '', awayTeam = '', homeCourtsWon = 0, awayCourtsWon = 0;
  const summaryRows = $('table').eq(2).find('tr');
  if (summaryRows.length >= 3) {
    const r1 = $(summaryRows.eq(1)).find('td');
    const r2 = $(summaryRows.eq(2)).find('td');
    homeTeam      = $(r1.eq(0)).text().trim();
    homeCourtsWon = parseInt($(r1.eq(1)).text().trim()) || 0;
    awayTeam      = $(r2.eq(0)).text().trim();
    awayCourtsWon = parseInt($(r2.eq(1)).text().trim()) || 0;
  }

  if (!homeTeam) return null;

  const courts = [];
  $('table').slice(3).each((i, tbl) => {
    const rows = $(tbl).find('tr');
    if (rows.length < 2) return;
    const headerText = $(rows.eq(0)).text().replace(/\s+/g, ' ').trim();
    if (!headerText.includes('Home Team') || !headerText.includes('Visiting Team')) return;

    const cells = $(rows.eq(1)).find('td');
    if (cells.length < 7) return;

    const homeNames   = $(cells.eq(0)).find('a').map((_, a) => $(a).text().trim()).get();
    const homeRatings = $(cells.eq(0)).find('span').map((_, s) => parseFloat($(s).text())).get();
    const awayNames   = $(cells.eq(6)).find('a').map((_, a) => $(a).text().trim()).get();
    const awayRatings = $(cells.eq(6)).find('span').map((_, s) => parseFloat($(s).text())).get();

    const scoreHtml = $(cells.eq(3)).html() || '';
    const score = scoreHtml
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/ - /g, '-');

    const winner = $(cells.eq(2)).find('img').length > 0 ? 'home' : 'away';

    courts.push({
      courtNumber:  courts.length + 1,
      home_player1: homeNames[0]   || null,
      home_player2: homeNames[1]   || null,
      home_rating1: homeRatings[0] || null,
      home_rating2: homeRatings[1] || null,
      away_player1: awayNames[0]   || null,
      away_player2: awayNames[1]   || null,
      away_rating1: awayRatings[0] || null,
      away_rating2: awayRatings[1] || null,
      score,
      winner,
    });
  });

  if (courts.length === 0) return null;

  return { matchId: mid, date, venue, league, homeTeam, awayTeam, homeCourtsWon, awayCourtsWon, courts };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OnTheBubble — NEOTA 8.0 Mixed 40+ Scraper');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Phase 1: Teams ─────────────────────────────────────────────────────────
  console.log('\n[Phase 1] Scraping teams...\n');
  const visitedKeys = new Set();
  const queue       = [...SEED_URLS];
  const teams       = [];
  const matchIds    = new Set();

  while (queue.length > 0) {
    const url = queue.shift();
    const key = teamKey(url);
    if (visitedKeys.has(key)) continue;
    visitedKeys.add(key);

    const preview = decodeURIComponent((url.match(/teamname=([^&]+)/) || [])[1] || url);
    process.stdout.write(`  Fetching "${preview}"... `);

    const result = await scrapeTeamProfile(url);

    if (!result) {
      console.log('skipped (not Mixed 40+ 8.0)');
    } else {
      console.log(`✓  ${result.players.length} players | ${result.opponentUrls.length} opponents | ${result.leagueType} ${result.level}`);
      teams.push(result);

      for (const oppUrl of result.opponentUrls) {
        if (!visitedKeys.has(teamKey(oppUrl))) queue.push(oppUrl);
      }
      for (const s of result.schedule) {
        if (s.matchId && s.result !== '0-0') matchIds.add(s.matchId);
      }
    }

    if (queue.length > 0) await sleep(DELAY_MS);
  }

  const totalPlayers = teams.reduce((s, t) => s + t.players.length, 0);
  console.log(`\n  → ${teams.length} teams | ${totalPlayers} players | ${matchIds.size} played matches to fetch`);

  // ── Phase 2: Matches ───────────────────────────────────────────────────────
  console.log('\n[Phase 2] Scraping match results...\n');
  const matches = [];

  for (const mid of matchIds) {
    process.stdout.write(`  Match #${mid}... `);
    const match = await scrapeMatchResult(mid);
    if (match) {
      console.log(`✓  ${match.homeTeam} vs ${match.awayTeam}  ${match.homeCourtsWon}-${match.awayCourtsWon}  (${match.courts.length} courts)`);
      matches.push(match);
    } else {
      console.log('skipped (no data)');
    }
    await sleep(DELAY_MS);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Done. ${teams.length} teams | ${totalPlayers} players | ${matches.length} matches`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ teams, matches }, null, 2));
  console.log(`  Saved → ${OUT_FILE}`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
