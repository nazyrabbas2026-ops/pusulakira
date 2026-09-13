// Dil karışıklığı regresyon kontrolü.
//
// Amaç: uygulama Rusça veya İngilizce moddayken, ekrana basılan metinlerde
// Türkçe'ye özgü karakterler (ğ, ı, ş, ç, ö, ü ve büyük halleri) kalıp
// kalmadığını gerçek bir DOM üzerinde (index.html + app.js çalıştırılarak)
// tarar. Bu, locales/*.json dosyalarının kendi içindeki tutarlılığını
// kontrol eden scripts/i18n-regression.js'den farklıdır — o script çeviri
// anahtarlarının üçünde de var olduğunu doğrular, ama app.js içinde tr()
// çağrısı hiç kullanılmadan doğrudan yazılmış Türkçe metinleri (bu
// oturumda düzeltilen "Her ayın {day}'u" / "Fesih" gibi) YAKALAYAMAZ.
// Bu script, uygulamayı gerçekten ru/en moduna geçirip render edilen
// metni denetleyerek o boşluğu kapatır.
//
// Çalıştırma: `npm install` (jsdom devDependency olarak eklenmiş olmalı)
// sonra `node scripts/language-mix-regression.js` veya `npm run lang:check`.
//
// Bilinen sınırlamalar:
// - Kiracı/mülk/kişi adı gibi KULLANICI VERİSİ (bu depoda varsayılan olarak
//   boş) taranan metne karışırsa ve Türkçe karakter içeriyorsa yanlış
//   pozitif üretebilir — bu beklenir, gerçek veriyle çalışırken script'i
//   yorumlayan kişi bunu ayıklamalıdır.
// - "Türkçe" dil adı (dil seçicideki seçenek) ve "PusulaKira" gibi marka
//   adları kasıtlı olarak ALLOWLIST'te tutulur.
// - /api/* uçları gerçek bir sunucu olmadan yanıt veremez; script bunları
//   başarısız (404) yanıtlarla taklit eder — bu, app.js'in zaten sahip
//   olduğu try/catch + "veri yoksa boş göster" davranışına dayanır.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

// Marka adları, dil seçicideki kendi dilindeki etiketler ve benzeri kasıtlı
// olarak her modda Türkçe kalması gereken metinler.
const ALLOWLIST = ['PusulaKira', 'Türkçe', 'İstanbul'];

function stripAllowlisted(text) {
  let result = text;
  for (const phrase of ALLOWLIST) result = result.split(phrase).join('');
  return result;
}

async function main() {
  let JSDOM;
  try {
    ({ JSDOM } = require('jsdom'));
  } catch (error) {
    console.error(
      'jsdom bulunamadı. Bu script `npm install` çalıştırıldıktan sonra kullanılabilir ' +
        '(package.json içinde devDependency olarak eklendi).\n' +
        `Ayrıntı: ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  // Sözleşme bitişine/son ödemeye 15 gün kalan bir tarih: hem "yaklaşan"
  // rozetini hem de tarih hücrelerinin gerçek biçimlendirmesini tetikler.
  // beforeParse (Node tarafında çalışır) ve aşağıdaki beklenen-değer
  // hesaplamaları aynı değeri paylaşsın diye main() kapsamında tutuluyor.
  const soon = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    // file: URL so jsdom's default resource loader can fetch app.js/styles.css
    // straight from disk, relative to index.html, with no server involved.
    url: pathToFileURL(path.join(root, 'index.html')).href,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // localStorage: file: kökenler jsdom'da "opaque origin" sayıldığından
      // yerleşik localStorage erişimci (getter/setter'ı olmayan) sessizce
      // çalışmaz; düz `window.localStorage = {...}` ataması da sloppy modda
      // sessizce yok sayılır (yalnızca getter'ı olan bir özelliğe yazma
      // girişimi). Bu yüzden Object.defineProperty ile gerçek bir own-property
      // olarak üzerine yazmak gerekiyor.
      const store = new Map();
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        enumerable: true,
        value: {
          getItem: (key) => (store.has(key) ? store.get(key) : null),
          setItem: (key, value) => store.set(key, String(value)),
          removeItem: (key) => store.delete(key),
          clear: () => store.clear(),
        },
      });
      // app.js boş bir portföyle başlar; satır bazlı metinleri (ödeme günü
      // şablonu, durum rozeti, Fesih butonu) test edebilmek için tek bir
      // sahte kiracı tohumla. Sürüm etiketi app.js'in "temiz başlangıç"
      // temizliğini atlaması için mevcut veri sürümüyle eşleşmeli.
      window.localStorage.setItem('kiraPanelDataVersion', '4');
      // period/dueDate/contractEnd de dolduruluyor ki Ödemeler tablosundaki
      // "Ödeme dönemi"/"Son ödeme" (periodLabel/dueLabel), Sözleşmeler
      // tablosundaki "Yenileme tarihi" ve Genel Bakış'taki "Sözleşme
      // uyarıları" widget'ı gibi ÖNCEDEN BİÇİMLENDİRİLMİŞ (locale'e göre
      // Intl.DateTimeFormat ile hesaplanan) tarih hücreleri de gerçek veriyle
      // render edilsin — bunlar önceden boştu ve bu yüzden dil değişince DOM'a
      // hiç yazılmayan tarih metinleri (asıl hata) test tarafından hiç
      // görülemiyordu.
      window.localStorage.setItem(
        'kiraPanelTenants',
        JSON.stringify([
          {
            name: 'Test Kişi', initials: 'TK', property: 'Test Mülk', rent: 1000, day: 9,
            status: 'Bekliyor', payment: 'Bekliyor', color: 'av1',
            period: '2026-09', dueDate: soon, contractEnd: soon,
            contractDurationDays: 365, rentalCategory: 'Konut',
          },
        ]),
      );
      // fetch: /locales/*.json'ı diskten oku, /api/* uçlarını taklit et.
      window.fetch = async (url) => {
        const pathname = String(url).replace(/^https?:\/\/[^/]+/, '');
        if (pathname.startsWith('/locales/')) {
          try {
            const body = fs.readFileSync(path.join(root, pathname), 'utf8');
            return { ok: true, status: 200, json: async () => JSON.parse(body) };
          } catch {
            return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
          }
        }
        return { ok: false, status: 404, json: async () => ({ error: 'stubbed: no server in this check' }) };
      };
      window.addEventListener('error', () => {});
    },
  });

  const { window } = dom;
  // app.js <script src> etiketi jsdom'un kaynak yükleyicisiyle otomatik
  // çalışır; script'in bitmesini ve i18n başlatmasının tamamlanmasını bekle.
  // Not: app.js'teki `const`/`let` üst düzey değişkenler (ör. localeMessages)
  // window üzerinde bir özellik olarak GÖRÜNMEZ (yalnızca `function` ve `var`
  // bildirimleri window'a eklenir) — bu yüzden i18n kurulumunun bittiğini,
  // yalnızca setSiteLanguage sonrası oluşan dil seçici düğümünü bekleyerek,
  // DOM üzerinden anlıyoruz.
  await new Promise((resolve) => window.addEventListener('load', resolve));
  await waitUntil(() => typeof window.setSiteLanguage === 'function', 5000);
  await waitUntil(() => window.document.querySelector('.language-picker-trigger'), 5000);

  const turkishSpecific = /[ğışçöüİĞŞÇÖÜ]/;
  const findings = [];

  for (const lang of ['ru', 'en']) {
    window.setSiteLanguage(lang);
    await waitUntil(() => window.document.documentElement.lang === lang, 2000);
    const nodes = window.document.querySelectorAll('body *');
    for (const node of nodes) {
      // Sadece bu düğümün DOĞRUDAN metin düğümü çocuklarına bak (alt
      // elemanların metnini değil) — böylece hem düz <span>Bekliyor</span>
      // hem de ikon+metin karışık <button><svg/>Ödendi</button> yapıları
      // doğru yakalanır ve aynı metin birden çok kez raporlanmaz.
      let ownText = '';
      for (const child of node.childNodes) if (child.nodeType === 3) ownText += child.textContent;
      ownText = stripAllowlisted(ownText.trim());
      if (ownText && turkishSpecific.test(ownText)) {
        findings.push({ lang, selector: describe(node), text: ownText.slice(0, 120) });
      }
    }
  }

  // --- Hedefli tur testi: tr -> ru -> en -> tr, bilinen tarih hücrelerini
  // birebir doğrula. -----------------------------------------------------
  // Yukarıdaki genel tarama, ru/en modundayken Türkçe'ye özgü karakter kalıp
  // kalmadığını yakalar — ama bu oturumda düzeltilen asıl hata tam olarak
  // BUNUN TERSİ bir senaryoydu: kullanıcı önce Rusça'ya geçmiş, sonra
  // Türkçe'ye DÖNMÜŞ, ama Ödemeler tablosundaki tarih hücreleri Rusça
  // kalmıştı. Türkçe hedef metin Türkçe karakter İÇERDİĞİ için genel tarama
  // bu yönü test edemez. Bu bölüm, tenant.periodLabel/dueLabel ve sözleşme
  // yenileme tarihinin render edildiği bilinen seçicileri, her dil geçişinden
  // sonra (tr->ru->en->tr) aynı Intl.DateTimeFormat mantığıyla bağımsızca
  // hesaplanan beklenen metinle birebir karşılaştırır.
  const localeTagFor = (lang) => ({ tr: 'tr-TR', ru: 'ru-RU', en: 'en-US' })[lang];
  const expectedPeriod = (lang) => new Intl.DateTimeFormat(localeTagFor(lang), { month: 'long', year: 'numeric' }).format(new Date('2026-09-01T12:00:00'));
  const expectedDue = (lang) => new Intl.DateTimeFormat(localeTagFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${soon}T12:00:00`));
  const dateCellChecks = [
    { selector: '#paymentTableRows .payment-period', label: 'Ödeme dönemi (Ödemeler tablosu)', expected: expectedPeriod },
    { selector: '#paymentTableRows .payment-due', label: 'Son ödeme (Ödemeler tablosu)', expected: expectedDue },
    { selector: '#contractRows .trow span:nth-child(3) b', label: 'Yenileme tarihi (Sözleşmeler tablosu)', expected: expectedDue },
    { selector: '.contract-panel .contract-row .days small', label: 'Sözleşme uyarısı tarihi (Genel Bakış)', expected: expectedDue },
  ];
  const roundTripFindings = [];

  for (const lang of ['tr', 'ru', 'en', 'tr']) {
    window.setSiteLanguage(lang);
    await waitUntil(() => window.document.documentElement.lang === lang, 2000);
    for (const check of dateCellChecks) {
      const node = window.document.querySelector(check.selector);
      if (!node) {
        roundTripFindings.push({ lang, label: check.label, selector: check.selector, issue: 'düğüm bulunamadı (sayfa/markup değişmiş olabilir)' });
        continue;
      }
      const actual = node.textContent.trim();
      const expected = check.expected(lang);
      if (actual !== expected) {
        roundTripFindings.push({ lang, label: check.label, selector: check.selector, issue: `"${actual}" bekleniyordu "${expected}"` });
      }
    }
  }

  if (findings.length || roundTripFindings.length) {
    if (findings.length) {
      console.error(`Dil karışıklığı bulundu (${findings.length} örnek):`);
      for (const item of findings) console.error(`  [${item.lang}] ${item.selector}: "${item.text}"`);
    }
    if (roundTripFindings.length) {
      console.error(`Tarih hücresi tur testi başarısız (${roundTripFindings.length} örnek):`);
      for (const item of roundTripFindings) console.error(`  [${item.lang}] ${item.label} (${item.selector}): ${item.issue}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('Dil karışıklığı regresyonu geçti: ru/en modunda Türkçe\'ye özgü karakter bulunamadı ve tr->ru->en->tr tur testinde tüm tarih hücreleri doğru dile güncellendi.');
}

function describe(node) {
  const id = node.id ? `#${node.id}` : '';
  const cls = node.className && typeof node.className === 'string' ? `.${node.className.trim().split(/\s+/).join('.')}` : '';
  return `${node.tagName.toLowerCase()}${id}${cls}`;
}

function waitUntil(condition, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Zaman aşımı: koşul sağlanmadı.'));
      setTimeout(poll, 25);
    })();
  });
}

main().catch((error) => {
  console.error('Dil karışıklığı kontrolü çalıştırılamadı:', error);
  process.exitCode = 1;
});
