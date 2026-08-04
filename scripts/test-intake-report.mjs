/**
 * Tests for the data intake dashboard's classification and week maths.
 *
 * Two layers:
 *   1. Unit rules — a hand-written fixture covering every branch of the
 *      classifier, plus the date helpers. Runs offline, always.
 *   2. Golden week — the real staging rows behind
 *      Weekly-Data-Intake-Report-EXAMPLE.xlsx, asserted against the totals that
 *      workbook reports. Skipped until the fixture is captured (see below).
 *
 * The example workbook cannot be used as classifier *input*: its "All Files"
 * sheet holds derived output (Status, Detail, Comment), not the raw
 * Processed/Completed values. It only becomes a fixture once real staging rows
 * for that week have been captured to
 * scripts/fixtures/staging-week-2026-07-20.json.
 *
 * Usage:
 *   node scripts/test-intake-report.mjs
 *   node scripts/test-intake-report.mjs --verbose
 */

import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'staging-week-2026-07-20.json');

// Lets the imports below reach the project's TypeScript with its `@/` aliases
// and extensionless specifiers intact.
register('./ts-resolve-hooks.mjs', import.meta.url);

const VERBOSE = process.argv.includes('--verbose');

// ---------------------------------------------------------------------------
// Tiny assertion harness (this project has no test runner)
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    if (VERBOSE) console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n       expected: ${e}\n       actual:   ${a}`);
    console.log(`  FAIL ${name}`);
    console.log(`       expected: ${e}`);
    console.log(`       actual:   ${a}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Load the TypeScript modules
// ---------------------------------------------------------------------------

// Node 22.18+/24 strips TypeScript types natively, so these import directly.
let classify;
let dates;
let summarise;
let tickets;

try {
  classify = await import('@/lib/intake-report/classify');
  dates = await import('@/lib/intake-report/dates');
  summarise = await import('@/lib/intake-report/summarise');
  tickets = await import('@/lib/intake-report/tickets');
} catch (error) {
  console.error(
    'Could not import the TypeScript modules.\n' +
      'This script needs Node 22.18+ (native type stripping). Current: ' +
      `${process.version}\n\nOriginal error: ${error.message}`,
  );
  process.exit(1);
}

const { classifyStagingRow, toIntakeFileRow } = classify;
const {
  currentWeekKey,
  formatWeekEnding,
  isInWeek,
  isWeekKey,
  parseSheetTime,
  parseTicketCreatedDate,
  shiftWeek,
  weekKeyFor,
  weekRangeFor,
} = dates;
const { buildIntakeReport, buildOpenIssues } = summarise;
const { toOpenIssue } = tickets;

// ---------------------------------------------------------------------------
// 1. Date helpers
// ---------------------------------------------------------------------------

section('Date helpers');

// The sheet is day-first. new Date('01/07/2026') would say 7 January.
check(
  'parseSheetTime reads DD/MM/YYYY as day-first',
  parseSheetTime('01/07/2026 09:30')?.toISOString(),
  '2026-07-01T01:30:00.000Z', // 09:30 Perth = 01:30 UTC
);

check(
  'parseSheetTime handles the YYYY/MM/DD shape',
  parseSheetTime('2026/07/01 9:30')?.toISOString(),
  '2026-07-01T01:30:00.000Z',
);

check('parseSheetTime handles unpadded day/month', parseSheetTime('1/7/2026 9:05')?.toISOString(), '2026-07-01T01:05:00.000Z');
check('parseSheetTime rejects impossible dates', parseSheetTime('31/02/2026 09:30'), null);
check('parseSheetTime rejects junk', parseSheetTime('not a date'), null);
check('parseSheetTime rejects blank', parseSheetTime('   '), null);

check(
  'parseTicketCreatedDate reads ISO',
  parseTicketCreatedDate('2026-07-13T23:30:09.853Z')?.toISOString(),
  '2026-07-13T23:30:09.853Z',
);

// 26 July 2026 is a Sunday; its week starts Monday 20 July.
check('weekKeyFor(Sunday) returns that week\'s Monday', weekKeyFor(new Date('2026-07-26T04:00:00Z')), '2026-07-20');
check('weekKeyFor(Monday) returns itself', weekKeyFor(new Date('2026-07-20T04:00:00Z')), '2026-07-20');
check('formatWeekEnding matches the report title', formatWeekEnding('2026-07-20'), 'Week ending Sunday 26 July 2026');

// Perth is UTC+8: the week opens at 16:00 UTC the previous day.
const range = weekRangeFor('2026-07-20');
check('week starts Perth midnight Monday', range.start.toISOString(), '2026-07-19T16:00:00.000Z');
check('week ends Perth 23:59:59.999 Sunday', range.end.toISOString(), '2026-07-26T15:59:59.999Z');

// A file logged 23:30 Perth on the Sunday is still inside that week — under a
// naive UTC reading it would spill into the next one.
check(
  'late Sunday Perth time stays in the week',
  isInWeek(parseSheetTime('26/07/2026 23:30'), '2026-07-20'),
  true,
);
check(
  'early Monday Perth time is the next week',
  isInWeek(parseSheetTime('27/07/2026 00:30'), '2026-07-20'),
  false,
);

// isWeekKey guards the ?week= query param on /api/intake-report.
check('isWeekKey accepts a real date', isWeekKey('2026-07-20'), true);
check('isWeekKey rejects junk', isWeekKey('garbage'), false);
check('isWeekKey rejects an impossible date', isWeekKey('2026-02-31'), false);
check('isWeekKey rejects the wrong format', isWeekKey('20/07/2026'), false);
check('isWeekKey rejects a non-string', isWeekKey(20260720), false);
check('isWeekKey rejects empty', isWeekKey(''), false);

// Month boundaries are where week maths usually breaks.
check('shiftWeek crosses a month boundary backwards', shiftWeek('2026-07-06', -1), '2026-06-29');
check('shiftWeek crosses a month boundary forwards', shiftWeek('2026-06-29', 1), '2026-07-06');
check('shiftWeek crosses a year boundary', shiftWeek('2027-01-04', -1), '2026-12-28');
check('currentWeekKey is a Monday', new Date(`${currentWeekKey()}T00:00:00Z`).getUTCDay(), 1);

// ---------------------------------------------------------------------------
// 2. Classifier rules — one case per branch of the table
// ---------------------------------------------------------------------------

section('Classifier rules');

function classified(row) {
  const { bucket, detail, owner } = classifyStagingRow(row);
  return { bucket, detail, owner };
}

check(
  'Processed + Completed is done',
  classified({ Processed: 'Processed', Completed: 'Completed', AttachmentName: 'data.csv' }),
  { bucket: 'done', detail: 'Fully processed', owner: '' },
);

// The first correction: n8n's emailed report flagged these as errors.
check(
  'Pending + Completed is done, not an error',
  classified({ Processed: 'Pending', Completed: 'Completed', AttachmentName: 'data.csv' }),
  { bucket: 'done', detail: 'Completed', owner: '' },
);

check(
  'Completed + Completed is done',
  classified({ Processed: 'Completed', Completed: 'Completed', AttachmentName: 'data.csv' }),
  { bucket: 'done', detail: 'Completed', owner: '' },
);

check(
  'Facility flag needs action, owned by the data team',
  classified({ Processed: 'Processed', Completed: 'Completed with Facility flag', AttachmentName: 'a.xlsx' }),
  { bucket: 'action_needed', detail: 'Facility flag', owner: 'Data team' },
);

check(
  'Fuel flag needs action',
  classified({ Processed: 'Processed', Completed: 'Completed with Fuel flag', AttachmentName: 'a.txt' }),
  { bucket: 'action_needed', detail: 'Fuel flag', owner: 'Data team' },
);

check(
  'Validation flag needs action',
  classified({ Processed: 'Processed', Completed: 'Completed with Validation flag', AttachmentName: 'a.pdf' }),
  { bucket: 'action_needed', detail: 'Validation flag', owner: 'Data team' },
);

// "Completed with  flag" — the empty-kind case seen in the n8n source.
check(
  'flag with no kind still classifies',
  classified({ Processed: 'Processed', Completed: 'Completed with  flag', AttachmentName: 'a.pdf' }),
  { bucket: 'action_needed', detail: 'Flag', owner: 'Data team' },
);

check(
  '404 is Not found',
  classified({ Processed: 'Processed', Completed: '404 account missing', AttachmentName: 'a.csv' }),
  { bucket: 'action_needed', detail: 'Not found', owner: 'Dev to check' },
);

check(
  '409 is a tracker failure',
  classified({ Processed: 'Processed', Completed: '409 conflict', AttachmentName: 'a.csv' }),
  { bucket: 'action_needed', detail: 'Tracker not updated', owner: 'Dev to check' },
);

check(
  '500 is a tracker failure',
  classified({ Processed: 'Processed', Completed: '500 server error', AttachmentName: 'a.csv' }),
  { bucket: 'action_needed', detail: 'Tracker not updated', owner: 'Dev to check' },
);

check(
  'Processed with no output is lost in workflow',
  classified({ Processed: 'Processed', Completed: '', AttachmentName: 'a.csv' }),
  { bucket: 'action_needed', detail: 'Lost in workflow', owner: 'Dev to check' },
);

check(
  'Pending with no output is stuck',
  classified({ Processed: 'Pending', Completed: '', AttachmentName: 'a.xlsx' }),
  { bucket: 'action_needed', detail: 'Stuck (Pending)', owner: 'Dev to check' },
);

check(
  'Error + Unclassified',
  classified({ Processed: 'Error', Completed: 'Unclassified', AttachmentName: 'a.xlsx' }),
  { bucket: 'action_needed', detail: 'Unclassified', owner: 'Dev to check' },
);

check(
  'Error with another message',
  classified({ Processed: 'Error', Completed: 'boom', AttachmentName: 'a.xlsx' }),
  { bucket: 'action_needed', detail: 'Unrecognised data', owner: 'Dev to check' },
);

check(
  'nothing recorded at all',
  classified({ Processed: '', Completed: '', AttachmentName: 'a.pdf' }),
  { bucket: 'action_needed', detail: 'Not processed', owner: 'Dev to check' },
);

check(
  'unrecognised combination falls back to action needed',
  classified({ Processed: 'Sideways', Completed: 'Maybe', AttachmentName: 'a.pdf' }),
  { bucket: 'action_needed', detail: 'Unrecognised status', owner: 'Dev to check' },
);

section('Ignored attachments');

check(
  'inline image by status text',
  classified({ Processed: 'Processed', Completed: 'Inline image', AttachmentName: 'image001.png' }),
  { bucket: 'ignored', detail: 'Inline image', owner: '' },
);

check(
  'LOA by status text',
  classified({ Processed: 'Processed', Completed: 'LOA', AttachmentName: 'auth.pdf' }),
  { bucket: 'ignored', detail: 'LOA document', owner: '' },
);

// The second correction: n8n only tested the status text, so these were missed.
check(
  'image detected by filename alone',
  classified({ Processed: 'Processed', Completed: '', AttachmentName: 'image001.png' }),
  { bucket: 'ignored', detail: 'Inline image', owner: '' },
);

check(
  'docx detected by filename alone',
  classified({ Processed: 'Processed', Completed: '', AttachmentName: 'VALVOLINE.docx' }),
  { bucket: 'ignored', detail: 'Non-data doc', owner: '' },
);

check(
  'known cover page detected by filename',
  classified({ Processed: 'Processed', Completed: '', AttachmentName: 'AGL.pdf' }),
  { bucket: 'ignored', detail: 'Cover attachment', owner: '' },
);

// Ordering guard: a flagged file is also Processed, and would land in `done` if
// the generic rule were checked first.
check(
  'flag rule beats the generic Processed rule',
  classified({ Processed: 'Processed', Completed: 'Completed with Facility flag' }).bucket,
  'action_needed',
);

section('Row mapping');

const mapped = toIntakeFileRow({
  row_number: 2048,
  Client: '',
  AttachmentName: 'thing.csv',
  Processed: 'Processed',
  Completed: 'Completed',
  Category: 'Stationary Energy',
  'Input Type': 'Diesel',
  'Issue Resolved': 'Y',
  Time: '20/07/2026 10:00',
});

check('blank client becomes (unassigned)', mapped.customer, '(unassigned)');
check('row number carries through', mapped.rowNumber, 2048);
check('category carries through', mapped.category, 'Stationary Energy');
check('input type carries through', mapped.inputType, 'Diesel');
check('Issue Resolved = Y is read', mapped.issueResolved, true);
check('time is serialised as ISO', mapped.time, '2026-07-20T02:00:00.000Z');

// ---------------------------------------------------------------------------
// 3. Summariser
// ---------------------------------------------------------------------------

section('Summariser');

const sampleFiles = [
  { Processed: 'Processed', Completed: 'Completed', Client: 'Acme', AttachmentName: 'a.csv', row_number: 1 },
  { Processed: 'Processed', Completed: 'Completed', Client: 'Acme', AttachmentName: 'b.csv', row_number: 2 },
  { Processed: 'Pending', Completed: '', Client: 'Acme', AttachmentName: 'c.csv', row_number: 3 },
  { Processed: 'Processed', Completed: 'Completed with Facility flag', Client: 'Beta', AttachmentName: 'd.csv', row_number: 4 },
  { Processed: 'Processed', Completed: '', Client: 'Beta', AttachmentName: 'image001.png', row_number: 5 },
].map(toIntakeFileRow);

const report = buildIntakeReport('2026-07-20', sampleFiles);

check('totals', report.totals, { received: 5, done: 2, actionNeeded: 2, ignored: 1 });
check(
  'buckets sum to received',
  report.totals.done + report.totals.actionNeeded + report.totals.ignored,
  report.totals.received,
);
check('week label', report.weekEndingLabel, 'Week ending Sunday 26 July 2026');
check('busiest customer first', report.byCustomer.map((c) => c.customer), ['Acme', 'Beta']);
check('per-customer counts', report.byCustomer[0], {
  customer: 'Acme', files: 3, done: 2, actionNeeded: 1, ignored: 0,
});

// Action needed first, and within it Dev to check above Data team.
check(
  'sort puts hard failures above flagged files',
  report.files.map((f) => f.detail),
  ['Stuck (Pending)', 'Facility flag', 'Fully processed', 'Fully processed', 'Inline image'],
);

section('Open issues');

const now = new Date('2026-07-31T00:00:00Z');
const sampleTickets = [
  {
    'Row in Staging': '1987', Status: 'Review', 'Created Date': '2026-07-13T23:30:09.853Z',
    Client: 'Fredon', 'File Name': 'a.pdf', 'Error Type': 'Completed with Validation flag',
    'Alistair: what to do': 'Investigate the validation failure.', Rerun: '',
  },
  {
    'Row in Staging': '1794', Status: 'Open', 'Created Date': '2026-06-24T23:30:10.683Z',
    Client: 'NRW Holdings', 'File Name': 'b.pdf', 'Error Type': 'Completed with Facility flag',
    'Ethan: what to do': 'Check unmatched items.', Rerun: 'Y',
  },
  {
    'Row in Staging': '1800', Status: 'Closed', 'Created Date': '2026-06-25T23:30:11.071Z',
    Client: 'Total AMS', 'File Name': 'c.pdf', 'Error Type': 'Completed with Flag',
    'Alistair: what to do': 'Investigate.', Rerun: '',
  },
  {
    'Row in Staging': '2009', Status: '', 'Created Date': '2026-07-15T23:30:11.387Z',
    Client: 'CBH Group', 'File Name': 'd.pdf', 'Error Type': 'Tracker Not Updated',
    'Adit: what to do': 'Investigate the API error.', Rerun: '',
  },
].map((row) => toOpenIssue(row, now));

const issues = buildOpenIssues(sampleTickets);

check('closed tickets are excluded', issues.totals.open, 3);
check('rerun requests are counted', issues.totals.awaitingRerun, 1);
check('oldest age in days', issues.totals.oldestAgeDays, 36);
check('oldest first', issues.issues.map((i) => i.rowInStaging), [1794, 1987, 2009]);
check('blank status counts as open', sampleTickets[3].isOpen, true);
check('owner resolved from the populated column', sampleTickets[1].owner, 'Ethan');
check('next step resolved', sampleTickets[3].nextStep, 'Investigate the API error.');
check(
  'error types counted',
  issues.byErrorType.map((e) => e.errorType).sort(),
  ['Completed with Facility flag', 'Completed with Validation flag', 'Tracker Not Updated'],
);

// ---------------------------------------------------------------------------
// 4. Golden week — the example workbook's numbers
// ---------------------------------------------------------------------------

section('Golden week (staging rows 2046-2078)');

if (!existsSync(FIXTURE)) {
  console.log('  SKIPPED — fixture not captured yet.');
  console.log(`  Expected at: ${FIXTURE}`);
  console.log('  Capture it once Google Sheets credentials are configured:');
  console.log('    node scripts/capture-intake-fixture.mjs');
} else {
  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const golden = buildIntakeReport('2026-07-20', rows.map(toIntakeFileRow));

  check('golden totals', golden.totals, {
    received: 33, done: 16, actionNeeded: 9, ignored: 8,
  });
  check(
    'golden buckets sum to received',
    golden.totals.done + golden.totals.actionNeeded + golden.totals.ignored,
    golden.totals.received,
  );

  const EXPECTED_BY_CUSTOMER = [
    ['Total AMS', 10, 7, 2, 1],
    ['LCS Landscapes', 6, 3, 1, 2],
    ['Sadleirs Transport', 3, 2, 0, 1],
    ['Megasorber', 2, 0, 1, 1],
    ['Hort Enterprises', 2, 1, 0, 1],
    ['CBH Group', 2, 0, 1, 1],
    ['(unassigned)', 2, 1, 1, 0],
    ['Blue Lake Milling', 2, 0, 2, 0],
    ['NRW Holdings', 1, 1, 0, 0],
    ['NRW Civil & Mining', 1, 0, 0, 1],
    ['Primero', 1, 0, 1, 0],
    ['Stoddart', 1, 1, 0, 0],
  ];

  for (const [customer, files, done, actionNeeded, ignored] of EXPECTED_BY_CUSTOMER) {
    const actual = golden.byCustomer.find((c) => c.customer === customer);
    check(`golden ${customer}`, actual && {
      files: actual.files, done: actual.done, actionNeeded: actual.actionNeeded, ignored: actual.ignored,
    }, { files, done, actionNeeded, ignored });
  }
}

// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`All ${passed} assertions passed.`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:\n`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
