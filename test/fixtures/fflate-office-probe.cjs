const assert = require('node:assert/strict');
const { unzipSync, zipSync, strToU8, strFromU8 } = require(process.argv[2]);
const zipped = zipSync({ '中文.txt': strToU8('中文 123.45') });
assert.equal(strFromU8(unzipSync(zipped)['中文.txt']), '中文 123.45');

// CVE-2026-45820: declare a ZIP64 compressed size but provide no ZIP64 extra
// field. Run in a bounded child so a vulnerable version cannot hang the suite.
const archive = Buffer.from(zipped);
const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
assert.ok(central >= 0);
assert.equal(archive.readUInt16LE(central + 30), 0);
const end = archive.length - 22;
assert.equal(archive.readUInt32LE(end), 0x06054b50);
// A ZIP64 end record and locator must also be present; a sentinel in the
// central header alone does not select unzipSync's ZIP64 parser.
const zip64End = Buffer.alloc(56);
zip64End.writeUInt32LE(0x06064b50, 0);
zip64End.writeBigUInt64LE(44n, 4);
zip64End.writeUInt16LE(45, 12);
zip64End.writeUInt16LE(45, 14);
zip64End.writeBigUInt64LE(1n, 24);
zip64End.writeBigUInt64LE(1n, 32);
zip64End.writeBigUInt64LE(BigInt(end - central), 40);
zip64End.writeBigUInt64LE(BigInt(central), 48);
const locator = Buffer.alloc(20);
locator.writeUInt32LE(0x07064b50, 0);
locator.writeBigUInt64LE(BigInt(end), 8);
locator.writeUInt32LE(1, 16);
const regularEnd = Buffer.from(archive.subarray(end));
regularEnd.writeUInt16LE(0xffff, 8);
regularEnd.writeUInt16LE(0xffff, 10);
regularEnd.writeUInt32LE(0xffffffff, 16);
const malformed = Buffer.concat([archive.subarray(0, end), zip64End, locator, regularEnd]);
malformed.writeUInt32LE(0xffffffff, central + 20);
assert.throws(() => unzipSync(malformed));
process.stdout.write('ZIP64 rejected; Chinese ZIP round-trip passed.\n');
