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
