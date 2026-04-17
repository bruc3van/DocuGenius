import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectMacOSBinaryArchitectures, normalizeMacOSProcessArchitecture } from './macosBinary';

const MACHO_CPU_TYPE_X86_64 = 0x01000007;
const MACHO_CPU_TYPE_ARM64 = 0x0100000c;
const MACHO_THIN_MAGIC_64 = 0xfeedfacf;
const MACHO_FAT_MAGIC = 0xcafebabe;
const MACHO_FAT_MAGIC_64 = 0xcafebabf;

function withTempBinary(content: Buffer, run: (filePath: string) => void): void {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docugenius-macho-'));
    const filePath = path.join(tempDir, 'binary');

    try {
        fs.writeFileSync(filePath, content);
        run(filePath);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function createThinHeader(cpuType: number): Buffer {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt32LE(MACHO_THIN_MAGIC_64, 0);
    buffer.writeUInt32LE(cpuType, 4);
    return buffer;
}

function createFatHeader(cpuTypes: number[]): Buffer {
    const buffer = Buffer.alloc(8 + (cpuTypes.length * 20));
    buffer.writeUInt32BE(MACHO_FAT_MAGIC, 0);
    buffer.writeUInt32BE(cpuTypes.length, 4);

    cpuTypes.forEach((cpuType, index) => {
        const offset = 8 + (index * 20);
        buffer.writeUInt32BE(cpuType, offset);
    });

    return buffer;
}

function createFat64Header(cpuTypes: number[]): Buffer {
    const buffer = Buffer.alloc(8 + (cpuTypes.length * 32));
    buffer.writeUInt32BE(MACHO_FAT_MAGIC_64, 0);
    buffer.writeUInt32BE(cpuTypes.length, 4);

    cpuTypes.forEach((cpuType, index) => {
        const offset = 8 + (index * 32);
        buffer.writeUInt32BE(cpuType, offset);
    });

    return buffer;
}

describe('normalizeMacOSProcessArchitecture', () => {
    it('normalizes x64 aliases', () => {
        assert.strictEqual(normalizeMacOSProcessArchitecture('x64'), 'x86_64');
        assert.strictEqual(normalizeMacOSProcessArchitecture('x86_64'), 'x86_64');
    });

    it('normalizes arm64 aliases', () => {
        assert.strictEqual(normalizeMacOSProcessArchitecture('arm64'), 'arm64');
        assert.strictEqual(normalizeMacOSProcessArchitecture('aarch64'), 'arm64');
    });

    it('returns undefined for unsupported architectures', () => {
        assert.strictEqual(normalizeMacOSProcessArchitecture('ia32'), undefined);
    });
});

describe('inspectMacOSBinaryArchitectures', () => {
    it('detects a thin x86_64 Mach-O binary', () => {
        withTempBinary(createThinHeader(MACHO_CPU_TYPE_X86_64), (filePath) => {
            assert.deepStrictEqual(inspectMacOSBinaryArchitectures(filePath), ['x86_64']);
        });
    });

    it('detects a thin arm64 Mach-O binary', () => {
        withTempBinary(createThinHeader(MACHO_CPU_TYPE_ARM64), (filePath) => {
            assert.deepStrictEqual(inspectMacOSBinaryArchitectures(filePath), ['arm64']);
        });
    });

    it('detects both architectures in a universal Mach-O binary', () => {
        withTempBinary(createFatHeader([MACHO_CPU_TYPE_X86_64, MACHO_CPU_TYPE_ARM64]), (filePath) => {
            assert.deepStrictEqual(inspectMacOSBinaryArchitectures(filePath), ['x86_64', 'arm64']);
        });
    });

    it('supports fat64 Mach-O headers', () => {
        withTempBinary(createFat64Header([MACHO_CPU_TYPE_ARM64]), (filePath) => {
            assert.deepStrictEqual(inspectMacOSBinaryArchitectures(filePath), ['arm64']);
        });
    });

    it('throws for unsupported files', () => {
        withTempBinary(Buffer.from('not-a-mach-o'), (filePath) => {
            assert.throws(() => inspectMacOSBinaryArchitectures(filePath), /not a supported Mach-O binary/);
        });
    });
});
