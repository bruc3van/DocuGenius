import * as assert from 'assert';
import * as path from 'path';
import { pathContainsDirectorySegment } from './pathUtils';

describe('pathContainsDirectorySegment', () => {
    it('matches an exact directory segment', () => {
        const filePath = 'C:\\workspace\\DocuGenius\\file.md';
        const result = pathContainsDirectorySegment(filePath, 'DocuGenius', {
            pathModule: path.win32,
            caseInsensitive: true
        });

        assert.strictEqual(result, true);
    });

    it('does not match a partial directory segment', () => {
        const filePath = 'C:\\workspace\\DocuGenius-assets\\file.md';
        const result = pathContainsDirectorySegment(filePath, 'DocuGenius', {
            pathModule: path.win32,
            caseInsensitive: true
        });

        assert.strictEqual(result, false);
    });

    it('supports case-insensitive matching on win32-style paths', () => {
        const filePath = 'C:\\workspace\\docugenius\\file.md';
        const result = pathContainsDirectorySegment(filePath, 'DocuGenius', {
            pathModule: path.win32,
            caseInsensitive: true
        });

        assert.strictEqual(result, true);
    });

    it('supports case-sensitive matching on posix-style paths', () => {
        const filePath = '/workspace/docugenius/file.md';
        const result = pathContainsDirectorySegment(filePath, 'DocuGenius', {
            pathModule: path.posix,
            caseInsensitive: false
        });

        assert.strictEqual(result, false);
    });
});
