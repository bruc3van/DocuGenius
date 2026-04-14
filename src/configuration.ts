import * as vscode from 'vscode';

export class ConfigurationManager {
    private static readonly SECTION = 'documentConverter';

    /**
     * Check if auto-conversion is enabled
     */
    isAutoConvertEnabled(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('autoConvert', true);
    }

    /**
     * Check if existing files should be overwritten
     */
    shouldOverwriteExisting(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('overwriteExisting', true);
    }

    /**
     * Check if images should be extracted
     */
    shouldExtractImages(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('extractImages', true);
    }

    /**
     * Get minimum image size for extraction
     */
    getImageMinSize(): number {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<number>('imageMinSize', 100);
    }

    /**
     * Get supported image formats
     */
    getImageFormats(): string[] {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<string[]>('imageFormats', ['png', 'jpg', 'jpeg', 'gif', 'bmp']);
    }

    /**
     * Get image naming convention
     */
    getImageNamingConvention(): string {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<string>('imageNamingConvention', 'page_based');
    }

    /**
     * Get image output folder name
     */
    getImageOutputFolder(): string {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<string>('imageOutputFolder', 'images');
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<string[]>('supportedExtensions', ['.docx', '.xlsx', '.pptx', '.pdf']);
    }

    /**
     * Check if files should be organized in markdown subdirectory
     */
    shouldOrganizeInSubdirectory(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('organizeInSubdirectory', true);
    }

    /**
     * Check if success notifications should be shown
     */
    shouldShowSuccessNotifications(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('showSuccessNotifications', true);
    }

    /**
     * Check if project configuration file should be created
     */
    shouldCreateProjectConfig(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('createProjectConfig', true);
    }

    /**
     * Check if plain text files should be copied to knowledge base folder
     */
    shouldCopyTextFiles(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('copyTextFiles', false);
    }

    /**
     * Check if document splitting is enabled
     */
    isDocumentSplittingEnabled(): boolean {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<boolean>('enableDocumentSplitting', true);
    }

    /**
     * Get document splitting threshold (character count)
     */
    getDocumentSplittingThreshold(): number {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<number>('documentSplittingThreshold', 500000);
    }

    /**
     * Get batch conversion behavior setting
     */
    getBatchConversionBehavior(): 'askForEach' | 'askOnce' | 'convertAll' | 'skipAll' {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<'askForEach' | 'askOnce' | 'convertAll' | 'skipAll'>('batchConversionBehavior', 'askOnce');
    }

    /**
     * Get batch detection window in milliseconds
     */
    getBatchDetectionWindow(): number {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<number>('batchDetectionWindow', 3000);
    }

    /**
     * Get the name of the subdirectory for converted files
     */
    getMarkdownSubdirectoryName(): string {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        return config.get<string>('markdownSubdirectoryName', 'DocuGenius');
    }

    /**
     * Update a configuration value
     */
    async updateConfiguration(key: string, value: any, target?: vscode.ConfigurationTarget): Promise<void> {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        await config.update(key, value, target || vscode.ConfigurationTarget.Global);
    }

    /**
     * Get all configuration as an object
     */
    getAllConfiguration(): {
        autoConvert: boolean;
        overwriteExisting: boolean;
        extractImages: boolean;
        supportedExtensions: string[];
        imageMinSize: number;
        imageFormats: string[];
        imageNamingConvention: string;
        imageOutputFolder: string;
    } {
        return {
            autoConvert: this.isAutoConvertEnabled(),
            overwriteExisting: this.shouldOverwriteExisting(),
            extractImages: this.shouldExtractImages(),
            supportedExtensions: this.getSupportedExtensions(),
            imageMinSize: this.getImageMinSize(),
            imageFormats: this.getImageFormats(),
            imageNamingConvention: this.getImageNamingConvention(),
            imageOutputFolder: this.getImageOutputFolder()
        };
    }

    /**
     * Reset configuration to defaults
     */
    async resetToDefaults(): Promise<void> {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        await config.update('autoConvert', undefined, vscode.ConfigurationTarget.Global);
        await config.update('overwriteExisting', undefined, vscode.ConfigurationTarget.Global);
        await config.update('extractImages', undefined, vscode.ConfigurationTarget.Global);
        await config.update('supportedExtensions', undefined, vscode.ConfigurationTarget.Global);
    }

    /**
     * Validate configuration
     */
    validateConfiguration(): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        const extensions = this.getSupportedExtensions();

        // Check if extensions array is valid
        if (!Array.isArray(extensions) || extensions.length === 0) {
            errors.push('Supported extensions must be a non-empty array');
        }

        // Check if extensions have proper format
        for (const ext of extensions) {
            if (typeof ext !== 'string' || !ext.startsWith('.')) {
                errors.push(`Invalid extension format: ${ext}. Extensions must start with a dot.`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
