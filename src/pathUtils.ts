import * as path from 'path';

type PathModule = Pick<typeof path, 'parse' | 'resolve' | 'sep'>;

interface PathComparisonOptions {
    pathModule?: PathModule;
    caseInsensitive?: boolean;
}

function normalizeSegment(value: string, caseInsensitive: boolean): string {
    return caseInsensitive ? value.toLowerCase() : value;
}

export function pathContainsDirectorySegment(
    filePath: string,
    directoryName: string,
    options: PathComparisonOptions = {}
): boolean {
    const pathModule = options.pathModule ?? path;
    const caseInsensitive = options.caseInsensitive ?? process.platform === 'win32';
    const resolvedPath = pathModule.resolve(filePath);
    const normalizedRoot = pathModule.parse(resolvedPath).root;
    const segments = resolvedPath
        .slice(normalizedRoot.length)
        .split(pathModule.sep)
        .filter(Boolean)
        .map(segment => normalizeSegment(segment, caseInsensitive));

    const targetDirectory = normalizeSegment(directoryName, caseInsensitive);
    return segments.some(segment => segment === targetDirectory);
}
