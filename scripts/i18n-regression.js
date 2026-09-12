const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const languages = ['tr', 'ru', 'en'];
const dictionaries = Object.fromEntries(languages.map(language => [
  language,
  JSON.parse(fs.readFileSync(path.join(root, 'locales', `${language}.json`), 'utf8')),
]));

function flatten(value, prefix = '', result = {}) {
  for (const [key, item] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, fullKey, result);
    else result[fullKey] = item;
  }
  return result;
}

const flattened = Object.fromEntries(languages.map(language => [language, flatten(dictionaries[language])]));
const referenceKeys = Object.keys(flattened.tr).sort();
const failures = [];

for (const language of ['ru', 'en']) {
  const keys = Object.keys(flattened[language]).sort();
  for (const key of referenceKeys) if (!(key in flattened[language])) failures.push(`${language}: missing ${key}`);
  for (const key of keys) if (!(key in flattened.tr)) failures.push(`${language}: unexpected ${key}`);
  for (const [key, value] of Object.entries(flattened[language])) {
    if (key === 'language.tr') continue;
    if (typeof value === 'string' && /[ğışçöüİĞŞÇÖÜ]/.test(value)) failures.push(`${language}: Turkish character leak at ${key}: ${value}`);
  }
}

const requiredDynamicKeys = [
  'tenantUi.renewalIn', 'tenantUi.daysRemaining', 'tenantUi.recipient',
  'tenantUi.paymentDescription', 'tenantUi.rentNotice', 'tenantUi.contractActive',
  'tenantUi.receiptNotice', 'tenantUi.fileInfo', 'tenantUi.sidebarSlogan',
];
for (const language of languages) for (const key of requiredDynamicKeys) {
  if (!flattened[language][key]) failures.push(`${language}: dynamic UI key missing ${key}`);
}

if (failures.length) {
  console.error(`i18n regression audit failed (${failures.length})\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`i18n regression audit passed: ${referenceKeys.length} keys aligned across TR/RU/EN.`);
