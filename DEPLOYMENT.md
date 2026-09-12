# PusulaKira yayınlama notları

Bu proje Node.js 24 ve yerel SQLite veritabanı ile çalışır. Küçük ekipler için kalıcı disk sunan bir Node.js/VPS hosting uygundur. Salt statik hosting uygun değildir; uygulama sunucu ve veritabanı kullanır.

## Yayından önce

1. `kirapanel.db` dosyasının ayrı, güvenli bir yedeğini alın.
2. Canlı sunucuda Node.js 24 veya üstünü kullanın.
3. Proje klasörünü, `uploads` klasörünü ve `kirapanel.db` dosyasını kalıcı diskte tutun.
4. Başlatma komutu: `npm start` veya `node server.js`.
5. Hosting sağlayıcısında `PORT` değişkenini sağlayıcının verdiği değer olarak bırakın.
6. Kurulumdan sonra `https://alanadiniz.com/api/health` adresinin `ok: true` dönmesini kontrol edin.

## Alan adı

`pusulakira.com` için DNS panelinde hosting sağlayıcınızın verdiği A kaydını veya CNAME kaydını ekleyin. HTTPS sertifikasını sağlayıcının otomatik SSL hizmetiyle etkinleştirin.

## Canlı ortam notu

Bu sürüm tek sunuculu SQLite kullanır. Çoklu sunucu, yüksek trafik, gerçek SMS/e-posta veya banka entegrasyonu devreye alınmadan önce PostgreSQL, dosya depolama ve güvenli çevre değişkenlerine geçilmelidir.
