# PusulaKira

Kiracı, sözleşme, havale/EFT, dekont, peşin ödeme talebi ve yönetici operasyonlarını tek panelde takip eden yerel uygulama.

## Yerelde başlatma

Node.js yüklüyse proje klasöründe `node server.js` komutunu çalıştırın ve `http://localhost:3000` adresini açın. Başka bir port için örneğin `$env:PORT=3001; node server.js` kullanın.

Bilgisayarınızda `node` komutu yoksa Codex'in çalışma zamanı ile başlatabilirsiniz:

```powershell
$env:PORT=3001
& 'C:\Users\nazyr\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

## Mevcut akışlar

- Yönetici ve kiracı için e-posta/telefon koduyla giriş
- Kiracı/sözleşme oluşturma, sözleşme feshi ve yenileme bildirimi
- Havale/EFT, isteğe bağlı dekont ve manuel havale eşleştirme
- 3, 6 veya 12 aylık peşin kira talebi ve yönetici onayı
- İstek/şikâyet kutusu; Yeni, İncelendi, İşlemde ve Çözüldü takibi
- Tüm kiracılara duyuru yayınlama

## Canlıya geçmeden önce

Geliştirme modunda doğrulama kodu yalnızca yerel sunucu konsolunda görüntülenir. Gerçek SMS/e-posta gönderimi henüz bir sağlayıcıya bağlı değildir. Canlı kullanım için SMS/e-posta sağlayıcısı, HTTPS alan adı, güvenli oturum çerezi, yedekleme, oran sınırlama ve yetki denetimi kurulmalıdır. Bankadan otomatik hareket alma için de banka/açık bankacılık sağlayıcısının sözleşmesi ve API bilgileri gerekir; mevcut ekran manuel eşleştirme içindir.
