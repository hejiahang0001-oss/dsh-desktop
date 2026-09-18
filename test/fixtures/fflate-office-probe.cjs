const assert = require('node:assert/strict');
const { unzipSync, zipSync, strToU8, strFromU8 } = require(process.argv[2]);
const zipped = zipSync({ '中文.txt': strToU8('中文 123.45') });
assert.equal(strFromU8(unzipSync(zipped)['中文.txt']), '中文 123.45');

// CVE-2026-45820: declare a ZIP64 compressed size but provide no ZIP64 extra
// field. Run in a bounded child so a vulnerable version cannot hang the suite.
const malformed = Buffer.from(zipped);
const central = malformed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
assert.ok(central >= 0);
assert.equal(malformed.readUInt16LE(central + 30), 0);
malformed.writeUInt32LE(0xffffffff, central + 20);
assert.throws(() => unzipSync(malformed));
process.stdout.write('ZIP64 rejected; Chinese ZIP round-trip passed.\n');
