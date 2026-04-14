/**
 * Supported document extensions that require conversion to Markdown
 */
export const SUPPORTED_CONVERT_EXTENSIONS = ['.docx', '.xlsx', '.pptx', '.pdf'];

/**
 * Plain text and code-like extensions that can be copied to the knowledge base
 */
export const COPYABLE_EXTENSIONS = [
    '.md', '.markdown', '.mdown', '.mkd', '.mkdn',
    '.txt', '.text',
    '.json', '.jsonc',
    '.xml', '.html', '.htm',
    '.csv', '.tsv',
    '.log',
    '.yaml', '.yml',
    '.toml', '.ini', '.cfg', '.conf',
    '.sql',
];

/**
 * All extensions handled by the extension (conversion + copyable)
 */
export const ALL_SUPPORTED_EXTENSIONS = [...SUPPORTED_CONVERT_EXTENSIONS, ...COPYABLE_EXTENSIONS];
