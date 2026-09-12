# PusulaKira — Adım 1 veri ve layout tarama raporu

## Hata 1 — Kiracı sayısı

Kök neden: Sidebar rozeti ve Genel Bakış kartı `tenants.length` kullanıyordu. Bu hesap, süresi dolmuş veya feshedilmiş sözleşmeleri aktif kiracı sayısına dahil edebiliyordu.

Düzeltme: `tenantContractIsActive()` ve `activeTenantRecords()` tek veri kaynağı olarak eklendi. Sidebar rozeti ile “Aktif kiracı” kartı artık aynı seçiciyi kullanıyor.

Testler:

- Boş liste: sidebar `0`, kart `0`.
- Bir aktif sözleşme: sidebar `1`, kart `1`.
- Bir aktif + bir süresi dolmuş + bir feshedilmiş: sidebar `1`, kart `1`.

## Hata 2 — Yenileme kartı

Yenileme bilgisi sözleşme kartının içine taşındı. `position: static` akışında, negatif offset olmadan çalışıyor. Mobilde kart genişliği ebeveynine bağlı; tablet ve masaüstünde içerik genişliğinde kalıyor. Sabit header'ın altında kalan `tenant-main` üst boşluğu korunuyor.

## Hata 3 — Boş tablolar

Tekrar kullanılabilir `emptyStateMarkup()` oluşturuldu.

- Kiracılar: “Henüz kiracı eklenmedi.”, açıklama ve mevcut yeni-kiracı akışını açan CTA.
- Ödemeler: “Henüz ödeme kaydı yok.” ve kiracı bulunup bulunmamasına göre yönlendirici açıklama.

## Hata 4 — Genel tarama

- Ödemeler rozeti artık aktif kiracıların silinmemiş ve feshedilmemiş bekleyen ödemelerini sayıyor.
- “Bu ay beklenen”, “Tahsil edilen” ve “Kalan” kartları aynı `livePaymentRecords()` veri kümesinden hesaplanıyor.
- Tespit edilen diğer `fixed` öğeler ana sidebar, kiracı sidebar'ı ve header; bunlar kasıtlı navigasyon elemanları.
- Tespit edilen `absolute` öğeler dekoratif ikon, illüstrasyon ve modal kapatma kontrolü; veri kartı konumlandırmasında kullanılmıyor.
- Uzun ödeme satırları yatay kaydırılabilir tablo alanında tutuluyor; hücreler komşu kolonların üzerine taşmıyor.

## Doğrulama

- `scripts/data-consistency-regression.js`: üç veri senaryosu başarılı.
- `scripts/i18n-regression.js`: 224 TR/RU/EN anahtarı başarılı.
- Temiz tarayıcı profili: iki boş-durum mesajı, sayaçlar `0/0/0`.
- Dolu profil: sidebar kiracı `2`, dashboard aktif kiracı `2`, bekleyen ödeme rozeti `1`, beklenen ödeme `2`.
- Boş ve dolu profillerde tarayıcı console hata/uyarı sayısı: `0`.

Bu klasör henüz bir Git deposu olmadığı için görev başına commit oluşturulmadı.
