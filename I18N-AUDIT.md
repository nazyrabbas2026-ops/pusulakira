# PusulaKira i18n ve layout tarama raporu

## Kök neden

Uygulama bileşenleri ilk açılışta çevriliyor, ancak ödeme tablosu ve kiracı profili API/localStorage yenilemelerinden sonra Türkçe sabit metinlerle yeniden oluşturuluyordu. Bu son render katmanı artık dil kodunu yeniden uygular. Ödeme durumu da UI katmanında `PAID`, `OVERDUE`, `PENDING` kodlarına ayrılır.

## Düzeltilen alanlar

- Giriş kartındaki dil seçici, güvenli giriş rozetiyle aynı grid akışına alındı.
- Yenileme rozeti, sözleşme kartının içine ve normal doküman akışına taşındı.
- Rusça/İngilizce ödeme durumları ile aksiyonlar ayrıldı; ödenmiş satırda yinelenen “Ödendi” aksiyonu kaldırıldı.
- Ödeme tablosuna uzun RU/EN metinleri için sabit kolon sınırları ve yatay taşma güvenliği eklendi.
- Kiracı panelinde karşılama, son ödeme, yenileme, transfer etiketleri, dekont açıklamaları, bildirimler, geçmiş ve sol alt slogan locale dosyalarına taşındı.
- Kullanıcı adı, adres, gayrimenkul adı ve talep metni kullanıcı verisi olarak bırakıldı; çevrilmedi.

## Regresyon kontrolü

`node scripts/i18n-regression.js` locale anahtar eşitliğini, zorunlu dinamik alanları ve RU/EN sözlüklerindeki Türkçe karakter sızıntılarını denetler. `npm run check` akışına bağlanmıştır.
