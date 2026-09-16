# PusulaKira

Kiracı, sözleşme, ödeme takibi, havale/EFT ve dekont yönetimi, peşin kira
talebi, istek/şikâyet takibi ve kiracı duyurularını tek panelde toplayan
bir kira ve apartman yönetim uygulaması. Yönetici paneli ve ayrı bir
Kiracı Portalı içerir; arayüz Türkçe, Rusça ve İngilizce arasında anlık
olarak değiştirilebilir.

Node.js'in yerleşik `node:sqlite` modülü ve dosya tabanlı bir SQLite
veritabanı ile çalışan, harici bir veritabanı sunucusu gerektirmeyen tek
parça (frontend + API aynı süreçte) bir uygulamadır.

**Davranış kılavuzu:** [`CLAUDE.md`](./CLAUDE.md) · **Tasarım sistemi:**
[`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) — ikisi birbirini tamamlar:
CLAUDE.md nasıl çalışılacağını (kodlama disiplini, doğrulama, veritabanı
güvenliği), DESIGN-SYSTEM.md tüm ekranlar için kalıcı, tek doğru (single
source of truth) renk/tipografi/bileşen referansını tanımlar.

## Gereksinimler

- Node.js **24 veya üzeri** (`node:sqlite` modülü için gerekli — bkz. `package.json` → `engines`)

## Kurulum ve yerelde çalıştırma

```bash
npm install
npm start
```

Sunucu varsayılan olarak `http://localhost:3000` adresinde açılır. Farklı
bir port için:

```bash
PORT=3001 npm start
```

(PowerShell'de: `$env:PORT=3001; npm start`)

İlk çalıştırmada `kirapanel.db` (SQLite veritabanı) proje kökünde otomatik
oluşturulur; `uploads/` (dekont dosyaları) ve `backups/` klasörleri de
gerektiğinde otomatik oluşturulur. Bu üçü de `.gitignore`'dadır — yerel/
sunucu verisidir, depoya dahil edilmez.

## Ortam değişkenleri

`.env.example` dosyasını referans alın. Şu an sunucu bunları henüz
**okumuyor** — e-posta/SMS entegrasyonu ileride eklendiğinde devreye
girecek şekilde hazırlanmış:

| Değişken | Açıklama |
|---|---|
| `PORT` | Sunucunun dinleyeceği port (opsiyonel, varsayılan `3000`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | İleride e-posta gönderimi için (Resend) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | İleride SMS gönderimi için (Twilio) |
| `NODE_ENV=production` | Üretimde geliştirme/test kısayollarını (ör. konsola yazılan doğrulama kodu) kapatır |

## Test ve regresyon kontrolleri

```bash
npm run check       # sözdizimi + i18n anahtar bütünlüğü + veri tutarlılığı
npm run i18n:check  # yalnızca TR/RU/EN çeviri anahtarlarının hizası
npm run data:check  # yalnızca veri tutarlılığı senaryoları
npm run lang:check  # dil değiştirildiğinde ekranda yanlış dilde metin kalıp kalmadığını tarar
```

## Mevcut özellikler

- Ad soyad + parola ile yönetici ve kiracı girişi, ayrı Kiracı Portalı
- Kiracı/sözleşme oluşturma (otomatik sözleşme süresi hesabı, kısa/uzun
  dönem kiralama uyarıları), sözleşme feshi ve yenileme bildirimi
- Havale/EFT ile ödeme, isteğe bağlı dekont yükleme ve yönetici tarafında
  manuel havale eşleştirme
- 3, 6 veya 12 aylık peşin kira talebi ve yönetici onayı
- İstek/şikâyet kutusu (Yeni → İncelendi/İşlemde → Çözüldü takibi)
- Tüm kiracılara duyuru yayınlama
- Genel Bakış, Kiracılar, Ödemeler, Sözleşmeler, Gayrimenkuller, Raporlar
  ve Ayarlar sayfaları
- Türkçe / Rusça / İngilizce arayüz dili (anlık değiştirilebilir, sayfa
  yenilemeden)

## Dağıtım

Ayrıntılı canlıya alma kontrol listesi için `DEPLOYMENT.md`'ye bakın. Kısa
özet: bu proje kalıcı disk sunan bir Node.js hosting gerektirir (salt
statik hosting **çalışmaz** — sunucu tarafı SQLite dosyası ve dosya
yüklemeleri var).

**Railway ile dağıtım:**

1. Depoyu Railway'de yeni bir proje olarak bağlayın (GitHub reposundan
   otomatik dağıtım).
2. Railway, `package.json`'daki `npm start` komutunu otomatik algılar;
   ekstra bir yapılandırma dosyası (Procfile vb.) gerekmez.
3. Railway'in verdiği `PORT` değişkenini olduğu gibi bırakın — sunucu
   `process.env.PORT`'u zaten okuyor.
4. **Kalıcı disk (Volume) ekleyin** ve proje kökünü (ya da en azından
   `kirapanel.db`, `uploads/`, `backups/` yollarını) bu volume'e
   bağlayın — aksi hâlde her yeniden dağıtımda veritabanı ve yüklenen
   dekontlar sıfırlanır.
5. Dağıtımdan sonra `https://<railway-domain>/api/health`'in
   `{"ok":true}` döndüğünü doğrulayın.
6. Kendi alan adınızı bağlayacaksanız Railway'in "Custom Domain"
   ayarından CNAME kaydını DNS sağlayıcınıza ekleyin; HTTPS sertifikası
   Railway tarafından otomatik sağlanır.

## Canlıya geçmeden önce

Geliştirme modunda doğrulama kodu yalnızca yerel sunucu konsolunda
görüntülenir; gerçek SMS/e-posta gönderimi henüz bir sağlayıcıya bağlı
değildir. Canlı kullanım için SMS/e-posta sağlayıcısı, HTTPS alan adı,
güvenli oturum çerezi/anahtarı, düzenli yedekleme, oran sınırlama ve
yetki denetimi kurulmalıdır. Bankadan otomatik hareket alma için de banka/
açık bankacılık sağlayıcısının sözleşmesi ve API bilgileri gerekir;
mevcut ekran manuel eşleştirme içindir.

Çok kullanıcılı/yüksek trafikli veya mobil istemcinin de bağlanacağı bir
kurulum için `kirapanel.db` (tek dosyalı SQLite) yerine PostgreSQL gibi
çok-istemcili bir veritabanına geçiş değerlendirilmelidir — bkz.
`DEPLOYMENT.md`.
