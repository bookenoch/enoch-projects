/**
 * scrape-player-stats.js
 *
 * Fetches 2025 season stats for every player in data/neota-scraped.json
 * from tennisrecord.com/adult/playerstats.aspx?playername=<name>&year=2025&mt=0
 *
 * Output: data/player-stats-scraped.json  { "<name>": { ...stats } }
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const BASE     = 'https://www.tennisrecord.com';
const DELAY_MS = 500;
const OUT_FILE = path.join(__dirname, '../data/player-stats-scraped.json');

const agent   = new https.Agent({ rejectUnauthorized: false });
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url) {
  const r = await axios.get(url, { httpsAgent: agent, headers, timeout: 15000 });
  return cheerio.load(r.data);
}

function parseRecordStr(s) {
  const m = (s || '').match(/^(\d+)-(\d+)\s*\(?([\d.]+)%?\)?/);
  return m ? { record: `${m[1]}-${m[2]}`, pct: parseFloat(m[3]) } : { record: s || null, pct: null };
}

async function scrapePlayerStats(playerName) {
  const url = `${BASE}/adult/playerstats.aspx?playername=${encodeURIComponent(playerName)}&year=2025&mt=0`;
  let $;
  try {
    $ = await fetchPage(url);
  } catch(e) {
    return null;
  }

  const stats = {};

  // Table 1: dynamic rating + NTRP cert date
  $('table').eq(1).find('tr').each((i, tr) => {
    const cells = $(tr).find('td').map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
    if (i === 0) {
      // "Phong Nguyen (Mentor, OH) Male   4.0 C12/31/2025"
      const m = (cells[1] || '').match(/^([\d.]+)\s+C(\d+\/\d+\/\d+)/);
      if (m) { stats.ntrp = parseFloat(m[1]); stats.ntrp_date = m[2]; }
    }
    if ((cells[0] || '').includes('Estimated Dynamic Rating')) {
      const parts = (cells[1] || '').split(' ');
      stats.dynamic_rating      = parseFloat(parts[0]) || null;
      stats.dynamic_rating_date = parts[1] || null;
    }
    if ((cells[0] || '').includes('Projected Year End')) {
      const v = cells[1] || '';
      stats.projected_rating = v.includes('-') ? null : (parseFloat(v) || null);
    }
  });

  // Table 3: season stats (labeled rows)
  const labelled = {};
  $('table').eq(3).find('tr').each((i, tr) => {
    const cells = $(tr).find('td').map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length >= 2 && (cells[0] || '').endsWith(':')) {
      labelled[cells[0].slice(0, -1)] = cells[1];
    }
  });

  if (labelled['Record']) {
    const r = parseRecordStr(labelled['Record']);
    stats.record_2025  = r.record;
    stats.win_pct_2025 = r.pct;
  }
  if (labelled['Current W/L Streak'])    stats.streak_2025       = labelled['Current W/L Streak'];
  if (labelled['Longest Winning Streak']) stats.longest_win_2025  = parseInt(labelled['Longest Winning Streak']) || 0;
  if (labelled['Longest Losing Streak'])  stats.longest_loss_2025 = parseInt(labelled['Longest Losing Streak'])  || 0;
  if (labelled['Postseason Record']) {
    const r = parseRecordStr(labelled['Postseason Record']);
    stats.postseason_record_2025 = r.record;
    stats.postseason_pct_2025    = r.pct;
  }
  if (labelled['Set Tiebreak Record']) {
    const r = parseRecordStr(labelled['Set Tiebreak Record']);
    stats.set_tb_record_2025 = r.record;
    stats.set_tb_pct_2025    = r.pct;
  }
  if (labelled['3rd Set Tiebreak Record']) {
    const r = parseRecordStr(labelled['3rd Set Tiebreak Record']);
    stats.third_set_record_2025 = r.record;
    stats.third_set_pct_2025    = r.pct;
  }
  if (labelled['Average Opponent Rating']) {
    stats.avg_opp_rating_2025 = parseFloat(labelled['Average Opponent Rating']) || null;
  }

  // Sanity check: if no record found the page probably 404'd or is empty
  if (!stats.record_2025) return null;
  return stats;
}

async function main() {
  const dataFile = process.argv[2] || path.join(__dirname, '../data/neota-scraped.json');
  console.log(`Reading: ${dataFile}`);
  const scraped = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const teams   = Array.isArray(scraped) ? scraped : (scraped.teams || []);

  // Load existing stats to merge (don't re-scrape players we already have)
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};

  // Deduplicate players by name, skip already-scraped
  const seen    = new Set(Object.keys(existing));
  const players = [];
  for (const t of teams) {
    for (const p of t.players) {
      if (!seen.has(p.name)) { seen.add(p.name); players.push(p.name); }
    }
  }

  console.log(`Scraping 2025 stats for ${players.length} new players (${Object.keys(existing).length} already cached)...\n`);

  const results = { ...existing };
  let ok = 0, skip = 0;

  for (const name of players) {
    process.stdout.write(`  ${name.padEnd(28)} `);
    const stats = await scrapePlayerStats(name);
    if (stats) {
      results[name] = stats;
      console.log(`✓  ${stats.record_2025}  (${stats.win_pct_2025}%)  streak ${stats.streak_2025}`);
      ok++;
    } else {
      console.log('— no 2025 data');
      skip++;
    }
    if (players.indexOf(name) < players.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${ok} players with stats, ${skip} skipped.`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Saved → ${OUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
