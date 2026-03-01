const axios   = require('axios');
const cheerio = require('cheerio');
const https   = require('https');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const URL = 'https://www.tennisrecord.com/adult/leagues/league.aspx';

async function inspect() {
  console.log('Fetching', URL, '...\n');

  const { data, status, headers } = await axios.get(URL, {
    httpsAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    timeout: 15000,
  });

  console.log('Status:', status);
  console.log('Content-Type:', headers['content-type']);
  console.log('Response size:', data.length, 'bytes\n');

  const $ = cheerio.load(data);

  // Page title
  console.log('=== PAGE TITLE ===');
  console.log($('title').text().trim());

  // Top-level structure
  console.log('\n=== TOP-LEVEL ELEMENTS ===');
  $('body > *').each((i, el) => {
    const tag = el.tagName;
    const id  = $(el).attr('id')    ? `#${$(el).attr('id')}`    : '';
    const cls = $(el).attr('class') ? `.${$(el).attr('class').split(' ').join('.')}` : '';
    console.log(`  ${tag}${id}${cls}`);
  });

  // All forms (often used for dropdowns/filters)
  console.log('\n=== FORMS ===');
  $('form').each((i, form) => {
    console.log(`  form#${$(form).attr('id') || '(no id)'} action="${$(form).attr('action') || ''}"`);
    $(form).find('select').each((j, sel) => {
      const name = $(sel).attr('name') || $(sel).attr('id') || '?';
      const opts = $(sel).find('option').map((k, o) => $(o).text().trim()).get().slice(0, 8);
      console.log(`    <select name="${name}"> options: ${opts.join(' | ')}${$(sel).find('option').length > 8 ? ' ...' : ''}`);
    });
    $(form).find('input[type="submit"], button[type="submit"], button').each((j, btn) => {
      console.log(`    <${btn.tagName} value="${$(btn).attr('value') || $(btn).text().trim()}">`);
    });
  });

  // All tables
  console.log('\n=== TABLES ===');
  $('table').each((i, tbl) => {
    const id  = $(tbl).attr('id')    ? `#${$(tbl).attr('id')}`    : '';
    const cls = $(tbl).attr('class') ? `.${$(tbl).attr('class')}` : '';
    const rows = $(tbl).find('tr').length;
    const firstRow = $(tbl).find('tr').first().text().replace(/\s+/g, ' ').trim().slice(0, 120);
    console.log(`  table${id}${cls} — ${rows} rows`);
    console.log(`    first row: "${firstRow}"`);
  });

  // All links containing keywords
  console.log('\n=== LINKS MATCHING "neota" OR "mixed" OR "40" ===');
  let found = 0;
  $('a').each((i, a) => {
    const text = $(a).text().trim();
    const href = $(a).attr('href') || '';
    if (/neota|mixed|40|league|district/i.test(text + href)) {
      console.log(`  "${text}" → ${href}`);
      if (++found >= 30) return false;
    }
  });
  if (found === 0) console.log('  (none found)');

  // Any element whose text contains NEOTA
  console.log('\n=== ELEMENTS CONTAINING "neota" OR "northeastern ohio" ===');
  let neotaFound = 0;
  $('*').each((i, el) => {
    const text = $(el).clone().children().remove().end().text().trim();
    if (/neota|northeastern ohio/i.test(text) && text.length < 200) {
      console.log(`  <${el.tagName}> "${text}"`);
      if (++neotaFound >= 20) return false;
    }
  });
  if (neotaFound === 0) console.log('  (none found — page may require POST or JS rendering)');

  // Dump first 3000 chars of raw HTML for structure clues
  console.log('\n=== RAW HTML (first 3000 chars) ===');
  console.log(data.slice(0, 3000));
}

inspect().catch(err => {
  console.error('Error:', err.message);
  if (err.response) {
    console.error('Status:', err.response.status);
    console.error('Body snippet:', String(err.response.data).slice(0, 500));
  }
});
