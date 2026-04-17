import * as fs from 'fs';

export type MacOSBinaryArchitecture = 'x86_64' | 'arm64';

const MACHO_CPU_TYPE_X86_64 = 0x01000007;
const MACHO_CPU_TYPE_ARM64 = 0x0100000c;
const MACHO_THIN_MAGIC_64 = 0xfeedfacf;
const MACHO_THIN_CIGAM_64 = 0xcffaedfe;
const MACHO_FAT_MAGIC = 0xcafebabe;
const MACHO_FAT_CIGAM = 0xbebafeca;
const MACHO_FAT_MAGIC_64 = 0xcafebabf;
const MACHO_FAT_CIGAM_64 = 0xbfbafeca;

function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
    return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readArchitecture(cpuType: number): MacOSBinaryArchitecture | undefined {
    if (cpuType === MACHO_CPU_TYPE_X86_64) {
        return 'x86_64';
    }

    if (cpuType === MACHO_CPU_TYPE_ARM64) {
        return 'arm64';
    }

    return undefined;
}

export function normalizeMacOSProcessArchitecture(processArch: string): MacOSBinaryArchitecture | undefined {
    switch (processArch) {
    case 'x64':
    case 'x86_64':
        return 'x86_64';
    case 'arm64':
    case 'aarch64':
        return 'arm64';
    default:
        return undefined;
    }
}

export function inspectMacOSBinaryArchitectures(binaryPath: string): MacOSBinaryArchitecture[] {
    const header = fs.readFileSync(binaryPath);
    if (header.length < 8) {
        throw new Error(`File is too small to be a Mach-O binary: ${binaryPath}`);
    }

    const littleEndianMagic = header.readUInt32LE(0);
    const bigEndianMagic = header.readUInt32BE(0);

    if (littleEndianMagic === MACHO_THIN_MAGIC_64 || bigEndianMagic === MACHO_THIN_CIGAM_64) {
        if (header.length < 8) {
            throw new Error(`Mach-O header is truncated: ${binaryPath}`);
        }

        const cpuType = readUInt32(header, 4, littleEndianMagic === MACHO_THIN_MAGIC_64);
        const architecture = readArchitecture(cpuType);
        if (!architecture) {
            throw new Error(`Unsupported Mach-O CPU type 0x${cpuType.toString(16)} in ${binaryPath}`);
        }

        return [architecture];
    }

    const isFat32 = bigEndianMagic === MACHO_FAT_MAGIC || littleEndianMagic === MACHO_FAT_CIGAM;
    const isFat64 = bigEndianMagic === MACHO_FAT_MAGIC_64 || littleEndianMagic === MACHO_FAT_CIGAM_64;

    if (!isFat32 && !isFat64) {
        throw new Error(`File is not a supported Mach-O binary: ${binaryPath}`);
    }

    const littleEndian = !(bigEndianMagic === MACHO_FAT_MAGIC || bigEndianMagic === MACHO_FAT_MAGIC_64);
    const architectureCount = readUInt32(header, 4, littleEndian);
    const entrySize = isFat64 ? 32 : 20;
    const headerSize = 8;
    const requiredSize = headerSize + (architectureCount * entrySize);
    if (header.length < requiredSize) {
        throw new Error(`Fat Mach-O header is truncated: ${binaryPath}`);
    }

    const architectures = new Set<MacOSBinaryArchitecture>();
    for (let index = 0; index < architectureCount; index++) {
        const offset = headerSize + (index * entrySize);
        const cpuType = readUInt32(header, offset, littleEndian);
        const architecture = readArchitecture(cpuType);
        if (architecture) {
            architectures.add(architecture);
        }
    }

    if (architectures.size === 0) {
        throw new Error(`No supported macOS architectures found in ${binaryPath}`);
    }

    return Array.from(architectures);
}
