'use strict';

const CANONICAL_TO_NICK = {
  'Timothy':     ['Tim', 'Timmy'],
  'Thomas':      ['Tom', 'Tommy'],
  'Robert':      ['Rob', 'Bob', 'Bobby', 'Robbie'],
  'William':     ['Will', 'Bill', 'Billy', 'Willy'],
  'Victoria':    ['Vicki', 'Vicky', 'Tori'],
  'Elizabeth':    ['Liz', 'Beth', 'Lizzy', 'Eliza', 'Betty'],
  'James':       ['Jim', 'Jimmy', 'Jamie'],
  'Joseph':      ['Joe', 'Joey'],
  'Daniel':      ['Dan', 'Danny'],
  'Richard':     ['Rich', 'Rick', 'Dick'],
  'Michael':     ['Mike', 'Mikey'],
  'David':       ['Dave', 'Davy'],
  'Christopher': ['Chris'],
  'Matthew':     ['Matt'],
  'Benjamin':    ['Ben', 'Benny'],
  'Jonathan':    ['Jon'],
  'Edward':      ['Ed', 'Eddie', 'Ted', 'Teddy'],
  'Patrick':     ['Pat'],
  'Katherine':   ['Kate', 'Katie', 'Kathy', 'Kat'],
  'Catherine':   ['Kate', 'Katie', 'Cathy', 'Cat'],
  'Alexander':   ['Alex'],
  'Alexandra':   ['Alex', 'Lexi'],
  'Andrew':      ['Andy', 'Drew'],
  'Samuel':      ['Sam', 'Sammy'],
  'Margaret':    ['Maggie', 'Meg', 'Peggy'],
  'Allison':     ['Allie', 'Ali'],
  'Alison':      ['Ali', 'Allie'],
  'Bradley':     ['Brad'],
  'Jennifer':    ['Jen', 'Jenny'],
  'Stephanie':   ['Steph'],
  'Rebecca':     ['Becca', 'Becky'],
  'Nicholas':    ['Nick', 'Nicky'],
  'Anthony':     ['Tony'],
  'Gregory':     ['Greg'],
  'Jessica':     ['Jess', 'Jessie'],
  'Stephen':     ['Steve'],
  'Steven':      ['Steve'],
  'Kenneth':     ['Ken', 'Kenny'],
  'Ronald':      ['Ron', 'Ronnie'],
  'Donald':      ['Don', 'Donnie'],
  'Charles':     ['Charlie', 'Chuck'],
  'Phillip':     ['Phil'],
  'Philip':      ['Phil'],
  'Lawrence':    ['Larry'],
  'Laurence':    ['Larry'],
  'Raymond':     ['Ray'],
  'Gerald':      ['Jerry'],
  'Dennis':      ['Denny'],
  'Douglas':     ['Doug'],
  'Christine':   ['Chris', 'Chrissy'],
  'Christina':   ['Chris', 'Tina'],
  'Deborah':     ['Deb', 'Debbie'],
  'Patricia':    ['Pat', 'Patty', 'Trish'],
  'Cynthia':     ['Cindy'],
  'Barbara':     ['Barb'],
  'Susan':       ['Sue', 'Susie'],
  'Suzanne':     ['Sue', 'Suzy'],
};

// Build bidirectional equivalence map
const _equivalence = new Map();

for (const [canonical, nicks] of Object.entries(CANONICAL_TO_NICK)) {
  const key = canonical.toLowerCase();
  if (!_equivalence.has(key)) _equivalence.set(key, new Set([canonical]));
  for (const nick of nicks) {
    const nkey = nick.toLowerCase();
    if (!_equivalence.has(nkey)) _equivalence.set(nkey, new Set([nick]));
    // Merge sets
    const merged = new Set([..._equivalence.get(key), ..._equivalence.get(nkey)]);
    _equivalence.set(key, merged);
    _equivalence.set(nkey, merged);
  }
}

function expandFirstNames(firstName) {
  const key = firstName.toLowerCase();
  const equivalents = _equivalence.get(key);
  if (!equivalents) return [firstName];
  return [...equivalents];
}

module.exports = { expandFirstNames };
