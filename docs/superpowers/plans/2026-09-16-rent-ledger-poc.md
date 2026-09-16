# Kira Tahakkuk Motoru (Faz A - PoC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design and prove (in an isolated copy database) a rent-charge/allocation ledger that replaces the simplistic `payments.status` model, without touching production `kirapanel.db`, without changing any `server.js` endpoint, and without any UI change.

**Architecture:** Two new, additive-only concepts sit alongside the existing schema: (1) `contract_rent_history` versions a tenant's rent amount/payment day over time so past periods are never recalculated; (2) `rent_charges` is one row per tenant per billing period (generated idempotently), and `payment_allocations` records how a `payments` row's amount was distributed across open charges (oldest-first) with any excess recorded as a `CREDIT`-type allocation. All business logic lives in a pure, injectable-`db` module (`lib/rent-ledger.js`) that is not required anywhere from `server.js` yet.

**Tech Stack:** Node.js built-in `node:sqlite` (`DatabaseSync`), `node:assert/strict` for tests (matches `scripts/*-regression.js` convention — no test framework is installed).

**Spec:** User's Faz A instructions (verbatim in conversation, 2026-09-16, "PUSULAKIRA — FAZ A: Kira Tahakkuk Motoru — İZOLE TASARIM VE DOĞRULAMA").

## Global Constraints

- Never write to or alter the schema of `kirapanel.db` (the real production file). All migration testing happens against a copy at `backups/schema-poc/test.db`.
- Never modify any existing table's schema; only add new tables.
- Never modify `server.js` request handling/routes in this phase.
- No UI changes in this phase.
- Money stays as whole-Lira `INTEGER` (matches existing `tenants.rent` / `payments.amount` columns already being `INTEGER`) — no floats, no kuruş subdivision (see Task 5 rationale).
- `backups/schema-poc/` (copy DB + throwaway runner script) must be fully deleted before the phase is reported done; only `lib/rent-ledger.js`, `migrations/002_rent_ledger.sql`, and the report survive.
- If any temporary server/process is started during proof, verify via `netstat` that its port is free again after cleanup.

---

## Task 1: Migration SQL (additive-only new tables)

**Files:**
- Create: `migrations/002_rent_ledger.sql`

**Interfaces:**
- Produces: table names/columns `contract_rent_history(id, tenant_id, rent_amount, payment_day, effective_from, created_at)`, `rent_charges(id, tenant_id, period, due_date, original_amount, adjustment_amount, total_amount, paid_amount, remaining_amount, status, created_at, updated_at)`, `payment_allocations(id, payment_id, rent_charge_id, type, amount, created_at, reversed_at)` — every later task's SQL/JS relies on these exact names.

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/002_rent_ledger.sql
-- Faz A: Kira tahakkuk motoru semasi (sadece ekleme, mevcut tablolara dokunmaz).
-- HENUZ UYGULANMADI. Faz B onayi olmadan kirapanel.db'ye calistirilmayacak.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contract_rent_history(
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  rent_amount INTEGER NOT NULL,
  payment_day INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_rent_history_tenant ON contract_rent_history(tenant_id, effective_from);

CREATE TABLE IF NOT EXISTS rent_charges(
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  original_amount INTEGER NOT NULL,
  adjustment_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIALLY_PAID','PAID')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  UNIQUE(tenant_id, period)
);
CREATE INDEX IF NOT EXISTS idx_rent_charges_tenant_status ON rent_charges(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rent_charges_due_date ON rent_charges(due_date);

CREATE TABLE IF NOT EXISTS payment_allocations(
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  rent_charge_id INTEGER,
  type TEXT NOT NULL DEFAULT 'CHARGE' CHECK(type IN ('CHARGE','CREDIT')),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  FOREIGN KEY(payment_id) REFERENCES payments(id),
  FOREIGN KEY(rent_charge_id) REFERENCES rent_charges(id)
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge ON payment_allocations(rent_charge_id);
```

- [ ] **Step 2: Sanity-check the SQL parses standalone**

Run: `node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); db.exec('CREATE TABLE tenants(id INTEGER PRIMARY KEY); CREATE TABLE payments(id INTEGER PRIMARY KEY);'); db.exec(require('fs').readFileSync('migrations/002_rent_ledger.sql','utf8')); console.log('migration OK');"`
Expected: prints `migration OK` with no errors (proves the SQL is valid against SQLite before touching any real file).

- [ ] **Step 3: Commit**

```bash
git add migrations/002_rent_ledger.sql
git commit -m "docs: add rent ledger migration SQL (not applied to production db)"
```

---

## Task 2: Business logic module — charge generation and rent versioning

**Files:**
- Create: `lib/rent-ledger.js`
- Test: `backups/schema-poc/test-rent-ledger.js` (temporary, deleted in Task 6)

**Interfaces:**
- Consumes: a `node:sqlite` `DatabaseSync` instance with Task 1's tables already created, plus the existing `tenants` table (`rent`, `payment_day`, `contract_end`, `termination_at`).
- Produces: `generateRentCharge(db, tenantId, period, opts)`, `applyRentChange(db, tenantId, newAmount, newPaymentDay, effectiveFromPeriod, opts)`, `periodKey(dateLike)`, `shiftPeriod(period, deltaMonths)`, `periodDueDate(period, paymentDay)` — used by every later task.

- [ ] **Step 1: Write the failing test (isolated DB, Task 1 migration applied)**

```js
// backups/schema-poc/test-rent-ledger.js (excerpt for this task)
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { generateRentCharge, applyRentChange, shiftPeriod } = require('../../lib/rent-ledger');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id INTEGER PRIMARY KEY,rent INTEGER NOT NULL,payment_day INTEGER NOT NULL,contract_end TEXT,termination_at TEXT);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,period TEXT NOT NULL,amount INTEGER NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL);`);
  db.exec(fs.readFileSync(path.join(__dirname, '../../migrations/002_rent_ledger.sql'), 'utf8'));
  return db;
}

// CASE 13: idempotent generation
{
  const db = freshDb();
  db.prepare('INSERT INTO tenants(id,rent,payment_day,contract_end) VALUES (1,30000,7,\'2027-01-05\')').run();
  const first = generateRentCharge(db, 1, '2026-09');
  const second = generateRentCharge(db, 1, '2026-09');
  const count = db.prepare('SELECT COUNT(*) c FROM rent_charges WHERE tenant_id=1 AND period=\'2026-09\'').get().c;
  assert.equal(first.created, true, 'CASE13: first call creates a charge');
  assert.equal(second.created, false, 'CASE13: second call must not create a duplicate');
  assert.equal(count, 1, 'CASE13: exactly one charge row for tenant+period');
  console.log('CASE13 PASS');
}

// CASE 9: rent change keeps history for past periods
{
  const db = freshDb();
  db.prepare('INSERT INTO tenants(id,rent,payment_day,contract_end) VALUES (1,30000,7,\'2027-01-05\')').run();
  const p0 = '2026-08', p1 = shiftPeriod(p0, 1);
  generateRentCharge(db, 1, p0);
  applyRentChange(db, 1, 36000, 7, p1);
  generateRentCharge(db, 1, p1);
  const c0 = db.prepare('SELECT total_amount FROM rent_charges WHERE tenant_id=1 AND period=?').get(p0);
  const c1 = db.prepare('SELECT total_amount FROM rent_charges WHERE tenant_id=1 AND period=?').get(p1);
  assert.equal(c0.total_amount, 30000, 'CASE9: past period keeps old amount');
  assert.equal(c1.total_amount, 36000, 'CASE9: new period uses new amount');
  console.log('CASE9 PASS');
}

// CASE 11: payment-day change keeps past due dates
{
  const db = freshDb();
  db.prepare('INSERT INTO tenants(id,rent,payment_day,contract_end) VALUES (1,30000,7,\'2027-01-05\')').run();
  const p0 = '2026-08', p1 = shiftPeriod(p0, 1);
  generateRentCharge(db, 1, p0);
  applyRentChange(db, 1, 30000, 10, p1);
  generateRentCharge(db, 1, p1);
  const c0 = db.prepare('SELECT due_date FROM rent_charges WHERE tenant_id=1 AND period=?').get(p0);
  const c1 = db.prepare('SELECT due_date FROM rent_charges WHERE tenant_id=1 AND period=?').get(p1);
  assert.equal(c0.due_date, `${p0}-07`, 'CASE11: past due date unchanged');
  assert.equal(c1.due_date, `${p1}-10`, 'CASE11: new due date uses new payment day');
  console.log('CASE11 PASS');
}

// CASE 12: contract ended -> no future charge, past preserved
{
  const db = freshDb();
  db.prepare('INSERT INTO tenants(id,rent,payment_day,contract_end,termination_at) VALUES (1,30000,7,\'2027-01-05\',\'2026-08-20T00:00:00.000Z\')').run();
  const p0 = '2026-08', p1 = shiftPeriod(p0, 1);
  const before = generateRentCharge(db, 1, p0);
  const after = generateRentCharge(db, 1, p1);
  assert.equal(before.created, true, 'CASE12: period before termination still charges');
  assert.equal(after.created, false, 'CASE12: no charge generated after termination');
  assert.equal(after.skipped, 'contract_ended', 'CASE12: skip reason recorded');
  const kept = db.prepare('SELECT COUNT(*) c FROM rent_charges WHERE tenant_id=1').get().c;
  assert.equal(kept, 1, 'CASE12: past charge preserved');
  console.log('CASE12 PASS');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node backups/schema-poc/test-rent-ledger.js`
Expected: `Error: Cannot find module '../../lib/rent-ledger'`

- [ ] **Step 3: Write minimal implementation**

```js
// lib/rent-ledger.js
'use strict';

function assertIntegerAmount(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} tam sayi (TL) olmalidir, ondalik/kurus kabul edilmez: ${value}`);
}

function periodKey(dateLike) {
  return String(dateLike).slice(0, 7);
}

function shiftPeriod(period, deltaMonths) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function periodDueDate(period, paymentDay) {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(paymentDay, lastDay);
  return `${period}-${String(day).padStart(2, '0')}`;
}

function activeTermFor(db, tenantId, period) {
  const row = db.prepare(
    `SELECT rent_amount, payment_day FROM contract_rent_history
     WHERE tenant_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`
  ).get(tenantId, period);
  if (row) return { rentAmount: row.rent_amount, paymentDay: row.payment_day };
  const tenant = db.prepare('SELECT rent, payment_day FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Kiraci bulunamadi: ${tenantId}`);
  return { rentAmount: tenant.rent, paymentDay: tenant.payment_day };
}

function generateRentCharge(db, tenantId, period, opts = {}) {
  const existing = db.prepare('SELECT * FROM rent_charges WHERE tenant_id = ? AND period = ?').get(tenantId, period);
  if (existing) return { charge: existing, created: false };

  const tenant = db.prepare('SELECT contract_end, termination_at FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Kiraci bulunamadi: ${tenantId}`);
  const boundary = tenant.termination_at || tenant.contract_end;
  if (boundary && period > periodKey(boundary)) {
    return { charge: null, created: false, skipped: 'contract_ended' };
  }

  const term = activeTermFor(db, tenantId, period);
  const adjustment = Number.isInteger(opts.adjustmentAmount) ? opts.adjustmentAmount : 0;
  const total = term.rentAmount + adjustment;
  const dueDate = periodDueDate(period, term.paymentDay);
  const timestamp = opts.now || new Date().toISOString();

  try {
    const result = db.prepare(
      `INSERT INTO rent_charges(tenant_id, period, due_date, original_amount, adjustment_amount, total_amount, paid_amount, remaining_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'OPEN', ?, ?)`
    ).run(tenantId, period, dueDate, term.rentAmount, adjustment, total, total, timestamp, timestamp);
    return { charge: db.prepare('SELECT * FROM rent_charges WHERE id = ?').get(result.lastInsertRowid), created: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { charge: db.prepare('SELECT * FROM rent_charges WHERE tenant_id = ? AND period = ?').get(tenantId, period), created: false };
    }
    throw err;
  }
}

function applyRentChange(db, tenantId, newAmount, newPaymentDay, effectiveFromPeriod, opts = {}) {
  assertIntegerAmount(newAmount, 'newAmount');
  if (!Number.isInteger(newPaymentDay) || newPaymentDay < 1 || newPaymentDay > 31) {
    throw new Error(`newPaymentDay 1-31 araliginda tam sayi olmalidir: ${newPaymentDay}`);
  }
  const timestamp = opts.now || new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO contract_rent_history(tenant_id, rent_amount, payment_day, effective_from, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(tenantId, newAmount, newPaymentDay, effectiveFromPeriod, timestamp);
  return { id: Number(result.lastInsertRowid) };
}

module.exports = {
  periodKey, shiftPeriod, periodDueDate,
  generateRentCharge, applyRentChange,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node backups/schema-poc/test-rent-ledger.js`
Expected: `CASE13 PASS`, `CASE9 PASS`, `CASE11 PASS`, `CASE12 PASS` all printed, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/rent-ledger.js
git commit -m "feat: add idempotent rent charge generation and rent versioning (unwired PoC module)"
```

---

## Task 3: Payment allocation, reversal, overdue summary

**Files:**
- Modify: `lib/rent-ledger.js` (append)
- Test: `backups/schema-poc/test-rent-ledger.js` (append, same temp file as Task 2)

**Interfaces:**
- Consumes: `rent_charges`/`payment_allocations` rows from Task 1/2.
- Produces: `allocatePayment(db, payment, opts)` returns `{allocations, creditAmount}`; `reverseAllocation(db, paymentId, opts)` returns `{reversed}`; `calculateOverdueSummary(db, tenantId, opts)` returns `{overdueCount, totalOverdueAmount, oldestOverdueDate}`.

- [ ] **Step 1: Write the failing tests (append to the same test file)**

```js
const { allocatePayment, reverseAllocation, calculateOverdueSummary } = require('../../lib/rent-ledger');

function chargeFor(db, tenantId, period, dueDate, rent) {
  db.prepare('INSERT OR IGNORE INTO tenants(id,rent,payment_day,contract_end) VALUES (?,?,?,\'2030-01-01\')').run(tenantId, rent, 7);
  return db.prepare(
    `INSERT INTO rent_charges(tenant_id,period,due_date,original_amount,adjustment_amount,total_amount,paid_amount,remaining_amount,status,created_at,updated_at)
     VALUES (?,?,?,?,0,?,0,?,'OPEN',?,?)`
  ).run(tenantId, period, dueDate, rent, rent, rent, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

// CASE 1: full payment -> PAID
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payRow = db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',30000,\'2026-08-07\',\'Odendi\')').run();
  allocatePayment(db, { id: Number(payRow.lastInsertRowid), tenantId: 1, amount: 30000 });
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'PAID', 'CASE1: status PAID');
  assert.equal(charge.remaining_amount, 0, 'CASE1: remaining 0');
  console.log('CASE1 PASS');
}

// CASE 2: partial payment -> PARTIALLY_PAID, 20000 remaining
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payRow = db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',10000,\'2026-08-07\',\'Odendi\')').run();
  allocatePayment(db, { id: Number(payRow.lastInsertRowid), tenantId: 1, amount: 10000 });
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'PARTIALLY_PAID', 'CASE2: status PARTIALLY_PAID');
  assert.equal(charge.remaining_amount, 20000, 'CASE2: remaining 20000');
  console.log('CASE2 PASS');
}

// CASE 3: 3 overdue periods -> 90000 total, 3 overdue
{
  const db = freshDb();
  chargeFor(db, 1, '2026-06', '2026-06-07', 30000);
  chargeFor(db, 1, '2026-07', '2026-07-07', 30000);
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const summary = calculateOverdueSummary(db, 1, { asOf: '2026-09-01' });
  assert.equal(summary.overdueCount, 3, 'CASE3: 3 overdue periods');
  assert.equal(summary.totalOverdueAmount, 90000, 'CASE3: 90000 total overdue');
  assert.equal(summary.oldestOverdueDate, '2026-06-07', 'CASE3: oldest date is June');
  console.log('CASE3 PASS');
}

// CASE 4: 90000 debt + 45000 payment -> oldest-first allocation
{
  const db = freshDb();
  chargeFor(db, 1, '2026-06', '2026-06-07', 30000);
  chargeFor(db, 1, '2026-07', '2026-07-07', 30000);
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payRow = db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',45000,\'2026-08-07\',\'Odendi\')').run();
  allocatePayment(db, { id: Number(payRow.lastInsertRowid), tenantId: 1, amount: 45000 });
  const rows = db.prepare('SELECT period,status,remaining_amount FROM rent_charges WHERE tenant_id=1 ORDER BY period').all();
  assert.deepEqual(rows.map(r => r.status), ['PAID', 'PARTIALLY_PAID', 'OPEN'], 'CASE4: oldest paid first');
  assert.equal(rows[1].remaining_amount, 15000, 'CASE4: July has 15000 remaining');
  assert.equal(rows[2].remaining_amount, 30000, 'CASE4: August untouched');
  const totalRemaining = rows.reduce((s, r) => s + r.remaining_amount, 0);
  assert.equal(totalRemaining, 45000, 'CASE4: 45000 total remaining across open charges');
  console.log('CASE4 PASS');
}

// CASE 5: 30000 debt + 40000 payment -> 30000 allocation + 10000 credit
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payRow = db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',40000,\'2026-08-07\',\'Odendi\')').run();
  const result = allocatePayment(db, { id: Number(payRow.lastInsertRowid), tenantId: 1, amount: 40000 });
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'PAID', 'CASE5: charge fully paid');
  assert.equal(result.creditAmount, 10000, 'CASE5: 10000 credit recorded');
  const creditRow = db.prepare('SELECT * FROM payment_allocations WHERE payment_id=? AND type=\'CREDIT\'').get(Number(payRow.lastInsertRowid));
  assert.ok(creditRow, 'CASE5: credit allocation row exists');
  assert.equal(creditRow.amount, 10000, 'CASE5: credit allocation amount 10000');
  console.log('CASE5 PASS');
}

// CASE 6: receipt upload alone must not close the debt (no allocatePayment call)
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  // Simulates "dekont yuklendi": no ledger function is invoked, matching that
  // an upload never calls allocatePayment in this architecture.
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'OPEN', 'CASE6: still OPEN after upload-only');
  assert.equal(charge.remaining_amount, 30000, 'CASE6: remaining unchanged after upload-only');
  console.log('CASE6 PASS');
}

// CASE 7: confirm -> debt closes/decreases
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payRow = db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',30000,\'2026-08-07\',\'Odendi\')').run();
  allocatePayment(db, { id: Number(payRow.lastInsertRowid), tenantId: 1, amount: 30000 });
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'PAID', 'CASE7: confirm closes the debt');
  console.log('CASE7 PASS');
}

// CASE 8: reversal reopens the debt
{
  const db = freshDb();
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const payId = Number(db.prepare('INSERT INTO payments(tenant_id,period,amount,due_date,status) VALUES (1,\'2026-08\',30000,\'2026-08-07\',\'Odendi\')').run().lastInsertRowid);
  allocatePayment(db, { id: payId, tenantId: 1, amount: 30000 });
  reverseAllocation(db, payId);
  const charge = db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get();
  assert.equal(charge.status, 'OPEN', 'CASE8: reopened to OPEN');
  assert.equal(charge.remaining_amount, 30000, 'CASE8: remaining restored to 30000');
  assert.equal(charge.paid_amount, 0, 'CASE8: paid_amount reset to 0');
  console.log('CASE8 PASS');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node backups/schema-poc/test-rent-ledger.js`
Expected: `TypeError: allocatePayment is not a function` (or similar — the export does not exist yet).

- [ ] **Step 3: Write minimal implementation (append to `lib/rent-ledger.js`, before the `module.exports` line)**

```js
function allocatePayment(db, payment, opts = {}) {
  if (!Number.isInteger(payment.amount)) throw new Error(`payment.amount tam sayi (TL) olmalidir: ${payment.amount}`);
  const openCharges = db.prepare(
    `SELECT * FROM rent_charges WHERE tenant_id = ? AND status != 'PAID' ORDER BY period ASC, id ASC`
  ).all(payment.tenantId);

  let remaining = payment.amount;
  const timestamp = opts.now || new Date().toISOString();
  const allocations = [];

  for (const charge of openCharges) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, charge.remaining_amount);
    if (applied <= 0) continue;
    const newPaid = charge.paid_amount + applied;
    const newRemaining = charge.total_amount - newPaid;
    const newStatus = newRemaining <= 0 ? 'PAID' : 'PARTIALLY_PAID';
    db.prepare('UPDATE rent_charges SET paid_amount=?, remaining_amount=?, status=?, updated_at=? WHERE id=?')
      .run(newPaid, Math.max(newRemaining, 0), newStatus, timestamp, charge.id);
    const allocResult = db.prepare(
      `INSERT INTO payment_allocations(payment_id, rent_charge_id, type, amount, created_at) VALUES (?, ?, 'CHARGE', ?, ?)`
    ).run(payment.id, charge.id, applied, timestamp);
    allocations.push({ id: Number(allocResult.lastInsertRowid), rentChargeId: charge.id, amount: applied, type: 'CHARGE' });
    remaining -= applied;
  }

  let creditAmount = 0;
  if (remaining > 0) {
    creditAmount = remaining;
    const allocResult = db.prepare(
      `INSERT INTO payment_allocations(payment_id, rent_charge_id, type, amount, created_at) VALUES (?, NULL, 'CREDIT', ?, ?)`
    ).run(payment.id, creditAmount, timestamp);
    allocations.push({ id: Number(allocResult.lastInsertRowid), rentChargeId: null, amount: creditAmount, type: 'CREDIT' });
  }

  return { allocations, creditAmount };
}

function reverseAllocation(db, paymentId, opts = {}) {
  const timestamp = opts.now || new Date().toISOString();
  const allocations = db.prepare('SELECT * FROM payment_allocations WHERE payment_id = ? AND reversed_at IS NULL').all(paymentId);
  for (const alloc of allocations) {
    db.prepare('UPDATE payment_allocations SET reversed_at=? WHERE id=?').run(timestamp, alloc.id);
    if (alloc.type === 'CHARGE' && alloc.rent_charge_id) {
      const charge = db.prepare('SELECT * FROM rent_charges WHERE id=?').get(alloc.rent_charge_id);
      const newPaid = Math.max(charge.paid_amount - alloc.amount, 0);
      const newRemaining = charge.total_amount - newPaid;
      const newStatus = newPaid <= 0 ? 'OPEN' : 'PARTIALLY_PAID';
      db.prepare('UPDATE rent_charges SET paid_amount=?, remaining_amount=?, status=?, updated_at=? WHERE id=?')
        .run(newPaid, newRemaining, newStatus, timestamp, charge.id);
    }
  }
  return { reversed: allocations.map(a => a.id) };
}

function calculateOverdueSummary(db, tenantId, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT * FROM rent_charges WHERE tenant_id = ? AND status != 'PAID' AND due_date < ? ORDER BY due_date ASC`
  ).all(tenantId, asOf);
  return {
    overdueCount: rows.length,
    totalOverdueAmount: rows.reduce((sum, r) => sum + r.remaining_amount, 0),
    oldestOverdueDate: rows.length ? rows[0].due_date : null,
  };
}
```

Also update the `module.exports` block to include the three new functions:

```js
module.exports = {
  periodKey, shiftPeriod, periodDueDate,
  generateRentCharge, applyRentChange,
  allocatePayment, reverseAllocation, calculateOverdueSummary,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node backups/schema-poc/test-rent-ledger.js`
Expected: `CASE1 PASS` through `CASE8 PASS` all printed (plus the Task 2 cases), exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/rent-ledger.js
git commit -m "feat: add payment allocation, reversal, and overdue summary to rent ledger"
```

---

## Task 4: Remaining independence case (CASE 10) + full suite assembly

**Files:**
- Test: `backups/schema-poc/test-rent-ledger.js` (append)

**Interfaces:**
- Consumes: all exports from Task 2/3.
- Produces: nothing new — this closes out the 13-case matrix (CASE10 was the only one not yet covered).

- [ ] **Step 1: Write the test**

```js
// CASE 10: editing tenant contact/email must not change financial history
{
  const db = freshDb();
  db.exec("ALTER TABLE tenants ADD COLUMN email TEXT");
  chargeFor(db, 1, '2026-08', '2026-08-07', 30000);
  const before = JSON.stringify(db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get());
  db.prepare('UPDATE tenants SET rent=rent, email=? WHERE id=1').run('kiraci@example.com');
  db.prepare("UPDATE tenants SET contract_end='2030-06-06' WHERE id=1").run();
  const after = JSON.stringify(db.prepare('SELECT * FROM rent_charges WHERE tenant_id=1').get());
  assert.equal(before, after, 'CASE10: rent_charges row is byte-identical after contact/email edits');
  console.log('CASE10 PASS');
}

console.log('ALL 13 CASES PASSED');
```

- [ ] **Step 2: Run and confirm all 13 pass**

Run: `node backups/schema-poc/test-rent-ledger.js`
Expected: 13 `CASEn PASS` lines + `ALL 13 CASES PASSED`, exit code 0.

- [ ] **Step 3: No commit yet** — this file lives only in `backups/schema-poc/` and is deleted in Task 6. Do not `git add` it.

---

## Task 5: Isolated-DB integration proof (real copy of kirapanel.db)

**Files:**
- Create (temporary): `backups/schema-poc/test.db` (copy of `kirapanel.db`)
- Create (temporary): `backups/schema-poc/apply-migration.js`

**Interfaces:**
- Consumes: `migrations/002_rent_ledger.sql`, `lib/rent-ledger.js`.
- Produces: proof that the migration applies cleanly to a real copy of the production schema/data and that the module functions run against it without touching `kirapanel.db`.

- [ ] **Step 1: Copy the real DB (never open the original in this task)**

```bash
mkdir -p backups/schema-poc
cp kirapanel.db backups/schema-poc/test.db
```

- [ ] **Step 2: Write and run the apply+smoke script against the copy only**

```js
// backups/schema-poc/apply-migration.js
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { generateRentCharge, applyRentChange, allocatePayment, calculateOverdueSummary } = require('../../lib/rent-ledger');

const dbPath = path.join(__dirname, 'test.db');
const db = new DatabaseSync(dbPath);
db.exec(fs.readFileSync(path.join(__dirname, '../../migrations/002_rent_ledger.sql'), 'utf8'));
console.log('migration applied to copy at', dbPath);

const tenant = db.prepare("SELECT id, rent, payment_day FROM tenants LIMIT 1").get();
if (tenant) {
  const period = '2026-09';
  const gen = generateRentCharge(db, tenant.id, period);
  console.log('generateRentCharge on real tenant row:', gen.created, gen.charge && gen.charge.total_amount);
  const summary = calculateOverdueSummary(db, tenant.id, { asOf: '2099-01-01' });
  console.log('calculateOverdueSummary on real tenant row:', summary);
} else {
  console.log('no tenant rows in copy — schema-only smoke test');
}
db.close();
```

Run: `node backups/schema-poc/apply-migration.js`
Expected: `migration applied to copy at ...test.db` printed, plus either the generate/summary lines or the "no tenant rows" line, no errors.

- [ ] **Step 3: Verify the production file is untouched**

Run: `git status --porcelain kirapanel.db` (or, since it's untracked/ignored, compare hash before/after)

```bash
sha256sum kirapanel.db
```

Expected: identical hash to the value captured before Task 5 Step 1 (record it before copying).

- [ ] **Step 4: No commit** — `backups/schema-poc/test.db` and `apply-migration.js` are deleted in Task 6, never staged.

---

## Task 6: Cleanup and verification

**Files:**
- Delete: `backups/schema-poc/` (entire directory: `test.db`, `apply-migration.js`, `test-rent-ledger.js`)

- [ ] **Step 1: Confirm no server/process was left running**

Run (Windows): `netstat -ano | findstr LISTENING | findstr :3999` (or whichever port, if any, was used — Task 5's script does not open a network port, so this should already show nothing)
Expected: no matching line.

- [ ] **Step 2: Delete the isolated proof folder**

```bash
rm -rf backups/schema-poc
```

- [ ] **Step 3: Confirm repo state — only intended files remain**

```bash
git status --porcelain
```

Expected: only `migrations/002_rent_ledger.sql`, `lib/rent-ledger.js`, `docs/superpowers/plans/2026-09-16-rent-ledger-poc.md`, and the report file show up as new/modified. `kirapanel.db` shows no change. No `backups/schema-poc/` entries.

- [ ] **Step 4: Commit the plan doc**

```bash
git add docs/superpowers/plans/2026-09-16-rent-ledger-poc.md
git commit -m "docs: add rent ledger Faz A PoC plan"
```

---

## Task 7: Report

**Files:**
- Create: `RENT-LEDGER-FAZ-A-RAPORU.md`

- [ ] **Step 1: Write the report** covering: (1) gaps found in the current schema with evidence (file:line citations from `server.js`), (2) the three new tables with full column/FK list, (3) the seven business-logic functions with one-line descriptions and file location, (4) all 13 test cases with scenario/expected/actual/PASS-FAIL, (5) the money/date strategy and why whole-Lira `INTEGER` was kept instead of switching to kuruş, (6) a proposed Faz B plan (real migration + gradual wiring into Ödemeler/Kiracılar pages), (7) open risks/ambiguities (notably: CASE 6/7's "dekont upload vs confirm" distinction is simulated here since no endpoint exists yet to call `allocatePayment` — Faz B must decide exactly which existing action, e.g. `mark-paid`, becomes the real trigger).

- [ ] **Step 2: Commit**

```bash
git add RENT-LEDGER-FAZ-A-RAPORU.md
git commit -m "docs: add Faz A rent ledger PoC report"
```
