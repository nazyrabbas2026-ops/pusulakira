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

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    // file: URL so jsdom's default resource loader can fetch app.js/styles.css
    // straight from disk, relative to index.html, with no server involved.
    url: pathToFileURL(path.join(root, 'index.html')).href,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // localStorage: jsdom sürümüne göre olmayabilir, güvenli bir yedek sağla.
      if (!window.localStorage) {
        const store = new Map();
        window.localStorage = {
          getItem: (key) => (store.has(key) ? store.get(key) : null),
          setItem: (key, value) => store.set(key, String(value)),
          removeItem: (key) => store.delete(key),
          clear: () => store.clear(),
        };
      }
      // app.js boş bir portföyle başlar; satır bazlı metinleri (ödeme günü
      // şablonu, durum rozeti, Fesih butonu) test edebilmek için tek bir
      // sahte kiracı tohumla. Sürüm etiketi app.js'in "temiz başlangıç"
      // temizliğini atlaması için mevcut veri sürümüyle eşleşmeli.
      window.localStorage.setItem('kiraPanelDataVersion', '4');
      window.localStorage.setItem(
        'kiraPanelTenants',
        JSON.stringify([
          { name: 'Test Kişi', initials: 'TK', property: 'Test Mülk', rent: 1000, day: 9, status: 'Bekliyor', payment: 'Bekliyor', color: 'av1' },
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

  if (findings.length) {
    console.error(`Dil karışıklığı bulundu (${findings.length} örnek):`);
    for (const item of findings) console.error(`  [${item.lang}] ${item.selector}: "${item.text}"`);
    process.exitCode = 1;
    return;
  }
  console.log('Dil karışıklığı regresyonu geçti: ru/en modunda Türkçe\'ye özgü karakter bulunamadı.');
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
