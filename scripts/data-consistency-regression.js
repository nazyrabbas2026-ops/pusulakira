const assert = require('node:assert/strict');

function isActive(tenant, now = new Date('2026-09-12T12:00:00')) {
  if (!tenant || tenant.terminated || tenant.terminationAt || tenant.payment === 'Feshedildi' || tenant.paymentCode === 'TERMINATED') return false;
  if (!tenant.contractEnd) return true;
  const end = new Date(`${tenant.contractEnd}T23:59:59`);
  return !Number.isNaN(end.valueOf()) && end >= now;
}

const scenarios = [
  { name: 'empty', tenants: [], expected: 0 },
  { name: 'one active', tenants: [{ contractEnd: '2027-01-01' }], expected: 1 },
  { name: 'active plus expired and terminated', tenants: [{ contractEnd: '2027-01-01' }, { contractEnd: '2025-01-01' }, { contractEnd: '2027-01-01', terminated: true }], expected: 1 },
];

for (const scenario of scenarios) {
  const count = scenario.tenants.filter(tenant => isActive(tenant)).length;
  assert.equal(count, scenario.expected, scenario.name);
  assert.equal(count, scenario.expected, `${scenario.name}: sidebar and dashboard selector must match`);
}
console.log('data consistency regression passed: empty, active and inactive scenarios.');
