# CLAUDE.md — PusulaKira Davranış Kılavuzu

Bu dosya, Claude Code'un **bu projede nasıl çalışması gerektiğine** dair
kalıcı bir davranış kılavuzudur. [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md)
görsel/tasarım kararlarının (renk, tipografi, boşluk, bileşen stili) tek
doğru kaynağıyken, bu dosya **çalışma disiplinini** — nasıl kod yazılacağını,
nasıl doğrulanacağını, ne zaman durup soru sorulacağını — kapsar. İkisi
birbirini tamamlar: görsel bir soru için DESIGN-SYSTEM.md'ye, davranışsal
bir soru için bu dosyaya bakılmalı.

## Proje kısaca

Saf HTML/CSS/JS (frontend: `index.html`, `app.js`, `styles.css`) + Node.js'in
yerleşik `http` modülü ve yerleşik `node:sqlite` (`DatabaseSync`) ile yazılmış
tek parça bir backend (`server.js`). **Express yok, better-sqlite3 yok, React
yok, TypeScript yok, build adımı yok.** Bu bilinçli bir mimari karardır —
bkz. Prensip 2.

---

## 1. Kodlamadan önce düşün

- Varsayımda bulunma. Belirsizlik varsa en makul yorumu seç, bunu açıkça
  belirt; birden fazla makul yorum varsa ilerlemeden önce netleştirme iste.
- Daha basit bir yaklaşım varsa söyle — karmaşık olanı otomatik seçme.
- **Bu projeye özel:** "Muhtemelen X'tir" diyerek ilerleme. Bugüne kadar
  defalarca (yönetici verisi yükleme sıralaması, kenar çubuğu genişliği, KPI
  kart renkleri gibi konularda) kod okuyarak yapılan tahminler gerçek
  render/computed-style değerinden farklı çıktı. Kod, hangi kuralın
  kazanacağını garanti etmez — CSS cascade'inde aynı seçici birden fazla yerde
  tanımlı olabilir (bkz. Prensip 3) ve JS'te çalışma zamanı sırası koddaki
  yazım sırasından farklı olabilir. Bir CSS/layout/veri sırası sorusunda,
  ilk bulduğun tanımı "doğru" sanma — gerçekten neyin göründüğünü/çalıştığını
  (tarayıcıda computed style, konsol çıktısı, gerçek DB sorgusu ile) ölçerek
  doğrula.

## 2. Sadelik önce

- Sadece istenen problemi çözecek minimum kodu yaz.
- İstenmeyen özellik, kullanılmayan soyutlama, gereksiz yapılandırılabilirlik
  ekleme.
- **Bu projeye özel:** Bu proje saf HTML/CSS/JS + Node.js `http`/`node:sqlite`
  ile çalışır. React, TypeScript, bir build adımı (webpack/vite/esbuild vb.)
  veya yeni bir framework/ORM **EKLEME** — bu konuda daha önce net kararlar
  alındı. Bir ihtiyaç bu sınırların dışına çıkıyor gibi görünüyorsa, önce
  bunu kullanıcıya söyle ve onay al; sessizce yeni bir bağımlılık ekleme.

## 3. Cerrahi değişiklikler

- Sadece dokunman gereken yere dokun. Komşu kodu/yorumları/formatlamayı
  "iyileştirme". Bozuk olmayan şeyi refactor etme.
- Mevcut kod stiline uy (bu proje minified/tek satır tarzı yoğun JS ve tek
  büyük `styles.css` dosyası kullanıyor — bunu kişisel tercihine göre
  yeniden biçimlendirme).
- **Bu projeye özel:** Bu kod tabanında "aynı seçici/kural birden fazla
  yerde koşulsuz tanımlı" deseni tekrar tekrar bulundu ve teknik borç
  yarattı (örnek: `.sidebar{width:...}` `styles.css` içinde 5 farklı yerde,
  farklı değerlerle tanımlı; benzer şekilde KPI kart arka planı ve
  `tenant-portal` blokları da tekrarlanan tanımlara sahip). Yeni bir CSS
  kuralı veya JS fonksiyonu eklerken **var olanı genişletmeyi tercih et**,
  yeni bir paralel kopya/üçüncü bir tanım oluşturmaktan kaçın — aksi hâlde
  hangi kuralın gerçekten kazandığını kimse (Claude dahil) güvenilir şekilde
  kestiremez ve Prensip 1'deki "tahmin etme, ölç" kuralı bir sonraki oturumda
  tekrar devreye girmek zorunda kalır.

## 4. Hedef odaklı çalışma

- Görevleri doğrulanabilir hedeflere dönüştür — "test yaz, sonra geçmelerini
  sağla" gibi düşün.
- Çok adımlı görevlerde kısa bir plan belirt, her adımın nasıl doğrulanacağını
  yaz.
- **Bu projeye özel — veritabanı disiplini:** Gerçek `kirapanel.db`'ye dokunan
  (yazma, migration, toplu güncelleme) her işlem için:
  1. Önce yedek al.
  2. Mümkünse izole bir kopya üzerinde test et (kopyayı ayrı bir dizine/porta
     al, gerçek dosyayı asla doğrudan hedefleme).
  3. Sunucu/port açtıysan iş bitince gerçekten kapandığını (`netstat` vb. ile)
     doğrula.
  Bu proje bugüne kadar production veritabanına yanlışlıkla test verisi
  yazma hatasını birkaç kez yaşadı — bu disiplin ihmal edilemez, "bu sefer
  küçük bir değişiklik" diye atlanmaz.

---

## Büyük/riskli değişikliklerde onay adımı

Veritabanı migration'ı, çok sayıda dosyayı etkileyen refactor veya üretim
verisine dokunan herhangi bir işlemden önce her zaman kısa bir plan sun ve
onay bekle — sessizce ilerleme. Küçük, geri alınabilir, tek dosyalık
düzeltmeler bu kapsamda değildir; ölçüt geri dönüşün maliyeti ve etkinin
kapsamıdır.

## Temizlik

Test/doğrulama amacıyla oluşturulan geçici dosyalar (örn. `*.tmp.js`, geçici
ekran görüntüsü klasörleri, izole DB kopyaları, farklı portta açılan test
sunucuları) iş bitince temizlenir. Ana projede kalıntı bırakılmaz — repo
durumu (`git status`) görev sonunda yalnızca kasıtlı olarak eklenen/değişen
dosyaları göstermelidir.
