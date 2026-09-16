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

module.exports = {
  periodKey, shiftPeriod, periodDueDate,
  generateRentCharge, applyRentChange,
  allocatePayment, reverseAllocation, calculateOverdueSummary,
};
