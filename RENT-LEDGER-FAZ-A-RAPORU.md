# Kira Tahakkuk Motoru — Faz A Raporu (İzole Tasarım ve Doğrulama)

Bu rapor, gerçek `kirapanel.db`'ye **hiçbir yazma/şema değişikliği yapılmadan**, izole bir kopya üzerinde yürütülen Faz A çalışmasının sonuçlarını özetler. Branch: `feature/rent-ledger-poc`.

## 1. Mevcut Şemada Tespit Edilen Gerçek Eksikler (kanıtlı)

- **Aylık tahakkuk döngüsü yok.** `payments` tablosuna satır sadece kiracı oluşturulurken bir kez ekleniyor (`server.js:74`, `INSERT INTO payments(...) VALUES(...,period(),...)`). Kod tabanında başka hiçbir yerde `INSERT INTO payments` çağrısı yok (doğrulama: `grep -n "INSERT INTO payments" server.js` tek sonucu satır 74). Yani ikinci ay geldiğinde sistemde o kiracı için yeni bir dönem kaydı **otomatik oluşmuyor** — kira takibi fiilen sadece ilk ayla sınırlı.
- **Kısmi ödeme desteklenmiyor.** `payments.status` sadece `'Bekliyor' | 'Ödendi' | 'Dekont yüklendi' | 'Feshedildi' | 'Silindi'` değerlerini alan tek bir metin alanı (`server.js:18,72`). Ne kısmi tutar (`paid_amount`) ne de kalan bakiye (`remaining_amount`) alanı var; `managerAction`'daki `mark-paid` işlemi (`server.js:76`) tüm tutarı tek seferde "Ödendi" yapıyor, ara değer yok.
- **Gecikme/borç birikimi izlenmiyor.** `ensureTimeBasedNotifications` (`server.js:87`) yalnızca *o anki* dönemin `due_date`'i geçmişse tek bir bildirim üretiyor; birden fazla dönem birikince toplam borç, gecikmiş dönem sayısı gibi bir özet hiçbir yerde hesaplanmıyor çünkü zaten geçmiş dönemler için ayrı satır tutulmuyor (yukarıdaki madde).
- **Kira/ödeme günü değişikliği için hiçbir endpoint yok.** `routes` tablosunda (`server.js:91`) kiracı oluşturma (`POST /api/tenants`), listeleme, sabit `manager-actions` (`terminate`, `mark-paid`, `delete-payment`, `receipt-required`) dışında `tenants.rent` veya `tenants.payment_day` alanını güncelleyen hiçbir handler yok. Bu, Faz A'nın önerdiği versiyonlama ihtiyacının (kira artışı gerçek bir özellik olarak eklenirse geçmişi bozmaması gerektiği) şu an tamamen teorik değil, gerçek bir boşluk olduğunu doğruluyor.
- **Ödeme–dönem ilişkisi 1:1 ve geri alınamaz.** `payments` bire bir `(tenant_id, period)` mantığıyla çalışıyor; bir ödemenin birden fazla döneme bölünmesi (`CASE 4`, `CASE 5`) veya onaylanmış bir ödemenin iptali (`CASE 8`) için hiçbir alan/mekanizma yok.

## 2. Tasarlanan Yeni Tablolar (sadece ekleme — bkz. `migrations/002_rent_ledger.sql`)

```sql
CREATE TABLE contract_rent_history(
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,          -- FK -> tenants(id)
  rent_amount INTEGER NOT NULL,        -- TL, tam sayı
  payment_day INTEGER NOT NULL,        -- 1-31
  effective_from TEXT NOT NULL,        -- 'YYYY-MM', bu dönemden itibaren geçerli
  created_at TEXT NOT NULL
);

CREATE TABLE rent_charges(
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,          -- FK -> tenants(id)
  period TEXT NOT NULL,                -- 'YYYY-MM'
  due_date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  original_amount INTEGER NOT NULL,
  adjustment_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | PARTIALLY_PAID | PAID
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, period)            -- idempotency garantisi (DB seviyesinde)
);

CREATE TABLE payment_allocations(
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL,         -- FK -> payments(id)  (mevcut tablo)
  rent_charge_id INTEGER,              -- FK -> rent_charges(id), CREDIT satırlarında NULL
  type TEXT NOT NULL DEFAULT 'CHARGE', -- CHARGE | CREDIT
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT                     -- iptal edilirse dolar
);
```

Tasarım kararı: mevcut şemada ayrı bir "contract" tablosu yok — sözleşme kavramı `tenants` satırının kendisi (bir kiracı = bir aktif sözleşme, fesih `termination_at` ile işaretleniyor). Bu yüzden yeni tablolar `contract_id` yerine mevcut desene uyarak doğrudan `tenant_id` kullanıyor.

## 3. Yazılan İş Mantığı Fonksiyonları (`lib/rent-ledger.js`, hiçbir endpoint'e bağlı değil)

| Fonksiyon | Açıklama |
|---|---|
| `generateRentCharge(db, tenantId, period, opts)` | Dönem için tahakkuk oluşturur; zaten varsa aynı satırı döner (idempotent), `UNIQUE(tenant_id,period)` ile DB seviyesinde de korunur. Sözleşme bitmiş/feshedilmişse (`termination_at` veya `contract_end` dönemi geçmişse) yeni tahakkuk üretmez. |
| `applyRentChange(db, tenantId, newAmount, newPaymentDay, effectiveFromPeriod, opts)` | `contract_rent_history`'e yeni bir versiyon satırı ekler; var olan `rent_charges` satırlarına dokunmaz. |
| `allocatePayment(db, payment, opts)` | Açık dönemleri en eskiden başlayarak kapatır; fazla kalan tutarı `type='CREDIT'` satırıyla işaretler. |
| `reverseAllocation(db, paymentId, opts)` | Bir ödemenin tüm aktif dağıtımlarını `reversed_at` ile iptal eder ve ilgili `rent_charges` satırlarını yeniden açar/kısmi hale getirir. |
| `calculateOverdueSummary(db, tenantId, opts)` | Açık/kısmi dönemlerden `due_date < asOf` olanları toplar: adet, toplam tutar, en eski tarih. |
| `periodKey`, `shiftPeriod`, `periodDueDate` | Yardımcı tarih/dönem fonksiyonları (dönem hesaplama, ay kaydırma, ödeme gününe göre son gün taşması dahil vade tarihi üretimi). |

## 4. 13 Test Senaryosu Sonuçları

Tüm senaryolar izole bir bellek-içi (`:memory:`) SQLite veritabanında (Task 2–4) **ve ayrıca gerçek `kirapanel.db`'nin `backups/schema-poc/test.db` kopyası üzerinde uygulanan migration ile** (Task 5) doğrulandı. Kopya klasörü iş bitince tamamen silindi; gerçek dosyanın SHA-256'sı çalışma öncesi/sonrası aynı kaldı (`912075d4e6...`).

| # | Senaryo | Beklenen | Gerçek Sonuç | Durum |
|---|---|---|---|---|
| 1 | ₺30.000 kira + ₺30.000 ödeme | PAID | status=PAID, remaining=0 | PASS |
| 2 | ₺30.000 kira + ₺10.000 ödeme | PARTIALLY_PAID, ₺20.000 kalan | status=PARTIALLY_PAID, remaining=20000 | PASS |
| 3 | 3×₺30.000 gecikmiş | ₺90.000 toplam, 3 dönem | overdueCount=3, totalOverdueAmount=90000 | PASS |
| 4 | ₺90.000 borç + ₺45.000 ödeme | en-eski-önce, doğru dağılım | PAID, PARTIALLY_PAID(15000 kalan), OPEN(30000); toplam kalan 45000 | PASS |
| 5 | ₺30.000 borç + ₺40.000 ödeme | ₺30.000 tahsil + ₺10.000 kredi | charge PAID, creditAmount=10000, CREDIT satırı mevcut | PASS |
| 6 | Dekont upload → borç kapanmamalı | OPEN kalmalı | status=OPEN, remaining=30000 | PASS |
| 7 | Dekont/ödeme onayı → borç kapanmalı | PAID | status=PAID | PASS |
| 8 | Onaylı ödeme iptali → borç yeniden açılmalı | OPEN, remaining=30000, paid=0 | status=OPEN, remaining=30000, paid_amount=0 | PASS |
| 9 | Kira ₺30.000→₺36.000 | geçmiş 30000 kalır, yeni dönem 36000 | eski dönem total=30000, yeni dönem total=36000 | PASS |
| 10 | Kiracı iletişim/e-posta düzenleme | finansal geçmiş değişmez | rent_charges satırı düzenleme öncesi/sonrası bit-bit aynı | PASS |
| 11 | Ödeme günü 7→10 | geçmiş vade tarihleri değişmez | eski dönem due_date=...-07, yeni dönem due_date=...-10 | PASS |
| 12 | Sözleşme bitti | gelecek tahakkuk oluşmaz, geçmiş korunur | önceki dönem oluştu, sonraki `created:false, skipped:'contract_ended'`, toplam 1 satır | PASS |
| 13 | Tahakkuk job 2 kez çalıştırılır | duplicate oluşmaz | ilk çağrı created:true, ikinci created:false, DB'de tek satır | PASS |

**13/13 PASS.**

## 5. Para/Tarih Hesaplama Stratejisi ve Gerekçesi

Tüm tutarlar **tam sayı Türk Lirası (`INTEGER`)** olarak tutuluyor; kuruş alt birimine geçilmedi. Gerekçe: mevcut şema zaten `tenants.rent` ve `payments.amount` alanlarını `INTEGER` olarak tanımlamış durumda (`server.js:15,18`) — yani uygulamanın tamamı zaten kuruşsuz, tam TL varsayımıyla çalışıyor. Yeni tablolarda farklı bir birim (ör. kuruş bazlı integer) seçmek, mevcut `payments.amount` ile yeni `rent_charges.total_amount` arasında birim tutarsızlığı yaratıp gelecekte gizli çarpım/bölüm hataları riski doğururdu. Bunun yerine iş mantığı katmanında (`assertIntegerAmount`) tüm giriş tutarlarının tam sayı olmasını zorunlu kılarak float sürüklenmesi (floating-point drift) baştan engellendi — hiçbir yerde `/`, `*` ile ondalık üretebilecek bir işlem yok; tüm toplama/çıkarma tam sayılar üzerinde. Tarihler `'YYYY-MM'` (dönem) ve `'YYYY-MM-DD'` (vade) metin formatında, mevcut `payments.due_date`/`period` ile birebir aynı biçimde tutuldu; ay sonu taşması (`periodDueDate`) `Date(y, m, 0).getDate()` ile güvenli şekilde hesaplanıyor (örn. ödeme günü 31 olan bir kiracı için Şubat'ta gün 28/29'a düşürülüyor).

## 6. Faz B Önerisi (SADECE plan — uygulanmadı)

1. **Gerçek migration:** `migrations/002_rent_ledger.sql`'i `kirapanel.db` üzerinde `db.exec(...)` ile mevcut `server.js` başlatma bloğuna (satır 13-28 civarı, diğer `CREATE TABLE IF NOT EXISTS` ifadelerinin yanına) ekle. Bu adım tek başına hiçbir davranışı değiştirmez (tablolar boş kalır).
2. **Arka planda dolduruma (backfill) job'ı:** Mevcut her aktif kiracı için geçmişe dönük eksik dönemleri `generateRentCharge` ile oluşturan tek seferlik bir script (`scripts/backfill-rent-charges.js`), mevcut `payments` tablosundaki geçmiş `status` bilgisini `allocatePayment`/direkt `UPDATE rent_charges` ile eşleyerek migrate eden ayrı bir adım.
3. **Kademeli endpoint bağlama:** Önce sadece **okuma** tarafını değiştir — `tenantList`/`portal` (server.js:73,75) sorgularına `rent_charges` bazlı özet alanları (ör. `overdueCount`, `totalOverdueAmount`) ekle, eski `payments.status` alanlarını UI'da paralel göster. Yazma tarafına (mark-paid, receipt confirm, terminate) sadece bu okuma tarafı bir süre sorunsuz çalıştıktan sonra dokun.
4. **Yazma tarafı geçişi:** `managerAction`'daki `mark-paid` → `allocatePayment` çağrısına, `terminate` → gelecek dönem `generateRentCharge` üretimini durdurmaya (zaten `boundary` kontrolü bunu otomatik yapıyor), yeni bir `reverse-payment` action'ı → `reverseAllocation`'a bağlanır.
5. **Kira/ödeme günü değişikliği UI'ı:** Yeni bir `PUT /api/tenants/:id/rent` endpoint'i eklenip `applyRentChange` çağrılır; bu, şu an var olmayan bir özelliği ilk kez ekleyeceği için ayrı bir onay gerektirir.
6. Her adımdan sonra `npm run check` ve mevcut regresyon script'leri (`data-consistency-regression.js` vb.) çalıştırılmalı; yeni bir `rent-ledger-regression.js` script'i `npm run check` zincirine eklenmeli.

## 7. Riskli/Belirsiz Noktalar

- **CASE 6/7 simülasyonu:** Sistemde şu an "dekont onaylandı" diye ayrı bir aksiyon yok — dekont yükleme (`receipt`, server.js:82) sadece `status='Dekont yüklendi'` yapıyor, gerçek onay `mark-paid` ile ayrı bir adımda gerçekleşiyor (server.js:76). Faz A'da bu iki senaryo, ilgili ledger fonksiyonunun (`allocatePayment`) çağrılıp çağrılmadığına göre simüle edildi. Faz B'de hangi gerçek aksiyonun `allocatePayment`'ı tetikleyeceği (muhtemelen `mark-paid`) net şekilde karara bağlanmalı.
- **Geriye dönük veri taşıma karmaşıklığı:** Mevcut `payments` tablosunda geçmiş dönemler için satır olmadığından (madde 1), Faz B'nin "backfill" adımı sadece mevcut tek `payments` satırını değil, kiracının `contract_start`'ından bugüne kadar olan **hiç var olmamış** ayları da yeniden inşa etmek zorunda kalacak — bu tahmini/varsayımsal geçmiş üretebilir ve dikkatli ele alınmalı.
- **Eşzamanlılık:** `node:sqlite` `DatabaseSync` senkron ve tek işlemli olduğu için mevcut kodda zaten kilitlenme riski yok; ancak `allocatePayment` + `generateRentCharge` çağrıları arasında transaction sınırı şu an yok — Faz B'de bu fonksiyonlar gerçek endpoint'lere bağlanırken `db.exec('BEGIN')/('COMMIT')` ile sarmalanması önerilir.

## Kalıntı Kontrolü

- `backups/schema-poc/` tamamen silindi (kopya DB + geçici script'ler dahil).
- `kirapanel.db` SHA-256: çalışma öncesi ve sonrası `912075d4e689f5eed71b905a93179736ba45ddf619e4211ad7ca66f87cfc5f03` (**değişmedi**).
- Hiçbir geçici sunucu/port açılmadı (doğrudan dosya tabanlı SQLite erişimi kullanıldı); `netstat`/`tasklist` kontrolünde node ile ilişkili dinleyen bir süreç bulunmadı.
- `server.js`, `app.js`, `index.html` bu fazda hiç değiştirilmedi.
