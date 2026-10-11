const { inflateRawSync } = require("zlib");

const MAX_ENTRIES = 5000;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function readZipEntries(buffer, shouldRead) {
    let eocd = -1;
    const searchStart = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= searchStart; offset--) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error("Invalid or unsupported PPTX archive.");
    const entryCount = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (entryCount > MAX_ENTRIES || offset >= buffer.length) throw new Error("PPTX archive contains too many entries.");
    const entries = new Map();
    let total = 0;
    for (let i = 0; i < entryCount; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Malformed PPTX archive directory.");
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
        const next = offset + 46 + nameLength + extraLength + commentLength;
        if (next > buffer.length) throw new Error("Malformed PPTX archive directory.");
        offset = next;
        if (!shouldRead(name)) continue;
        if ((flags & 1) !== 0 || ![0, 8].includes(method) || uncompressedSize > MAX_ENTRY_BYTES || compressedSize > buffer.length || localOffset + 30 > buffer.length) throw new Error("PPTX uses an unsupported or oversized archive entry.");
        total += uncompressedSize;
        if (total > MAX_TOTAL_BYTES) throw new Error("PPTX extracted content exceeds the processing limit.");
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Malformed PPTX archive entry.");
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buffer.length) throw new Error("Malformed PPTX archive entry.");
        const compressed = buffer.subarray(dataStart, dataEnd);
        const content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
        if (content.length !== uncompressedSize) throw new Error("PPTX entry size check failed.");
        entries.set(name, content);
    }
    return entries;
}

module.exports = { readZipEntries, MAX_ENTRY_BYTES };
