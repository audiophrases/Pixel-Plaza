// A small uncompressed ZIP writer. No dependencies, UTF-8 filenames, CRC32 and
// standard directory records; browser downloads can be opened by Windows/macOS.
export function zipFiles(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder();
    const pieces: Uint8Array[] = [], directory: Uint8Array[] = [];
    let offset = 0;
    const crc32 = (bytes: Uint8Array) => {
        let crc = 0xffffffff;
        for (const byte of bytes) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
        }
        return (crc ^ 0xffffffff) >>> 0;
    };
    for (const [path, data] of Object.entries(files)) {
        const name = encoder.encode(path), crc = crc32(data);
        const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
        l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
        l.setUint16(12, 0x21, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
        l.setUint16(26, name.length, true); local.set(name, 30);
        pieces.push(local, data);
        const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
        c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46); directory.push(central);
        offset += local.length + data.length;
    }
    const size = directory.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, directory.length, true); view.setUint16(10, directory.length, true);
    view.setUint32(12, size, true); view.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + end.length);
    let at = 0;
    for (const part of [...pieces, ...directory, end]) { result.set(part, at); at += part.length; }
    return result;
}
