import * as path from 'path';
import { localize } from './i18n';

/**
 * Split markdown content by headers (# to ######)
 */
export function splitByHeaders(content: string): string[] {
    const lines = content.split('\n');
    const sections: string[] = [];
    let currentSection = '';

    for (const line of lines) {
        if (line.trim().match(/^#{1,6}\s/)) {
            if (currentSection.trim().length > 0) {
                sections.push(currentSection + '\n');
            }
            currentSection = line + '\n';
        } else {
            currentSection += line + '\n';
        }
    }

    if (currentSection.trim().length > 0) {
        sections.push(currentSection);
    }

    return sections.length > 0 ? sections : [content];
}

/**
 * Create an index file for split documents
 */
export function createIndexFile(originalFileName: string, totalParts: number, baseName: string): string {
    let indexContent = `# ${localize('split.index.title', originalFileName)}\n\n`;
    indexContent += `${localize('split.index.description', totalParts)}\n\n`;
    indexContent += `## ${localize('split.index.partsHeading')}\n\n`;

    for (let i = 1; i <= totalParts; i++) {
        indexContent += `- [${localize('split.index.partLink', i)}](./${baseName}_part${i}.md)\n`;
    }

    indexContent += `\n---\n\n`;
    indexContent += `*${localize('split.index.generated')}*`;

    return indexContent;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect generated Markdown files related to a single output path.
 * This includes the main Markdown file plus split parts and index files.
 */
export function collectRelatedOutputFileNames(outputPath: string, directoryEntries: string[]): string[] {
    const relatedFiles = new Set<string>();
    const outputFileName = path.basename(outputPath);

    if (directoryEntries.includes(outputFileName)) {
        relatedFiles.add(outputFileName);
    }

    if (path.extname(outputPath).toLowerCase() !== '.md') {
        return Array.from(relatedFiles);
    }

    const baseName = path.basename(outputPath, '.md');
    const splitPattern = new RegExp(`^${escapeRegExp(baseName)}_(?:part\\d+|index)\\.md$`);

    for (const entry of directoryEntries) {
        if (splitPattern.test(entry)) {
            relatedFiles.add(entry);
        }
    }

    return Array.from(relatedFiles).sort((left, right) => {
        if (left === outputFileName) {
            return -1;
        }

        if (right === outputFileName) {
            return 1;
        }

        return left.localeCompare(right);
    });
}
