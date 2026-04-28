import * as vscode from 'vscode';
import { SUPPORTED_CONVERT_EXTENSIONS } from './constants';

export type BatchConversionBehavior = 'askForEach' | 'askOnce' | 'convertAll' | 'skipAll';
export type DeleteGeneratedOutputsBehavior = 'ask' | 'delete' | 'keep';

type ConfigKey =
    | 'autoConvert'
    | 'overwriteExisting'
    | 'organizeInSubdirectory'
    | 'markdownSubdirectoryName'
    | 'extractImages'
    | 'imageOutputFolder'
    | 'imageMinSize'
    | 'enableDocumentSplitting'
    | 'documentSplittingThreshold'
    | 'batchConversionBehavior'
    | 'showSuccessNotifications'
    | 'copyTextFiles'
    | 'createProjectConfig'
    | 'batchDetectionWindow'
    | 'deleteGeneratedOutputsBehavior';

interface ConfigDefaults {
    autoConvert: boolean;
    overwriteExisting: boolean;
    organizeInSubdirectory: boolean;
    markdownSubdirectoryName: string;
    extractImages: boolean;
    imageOutputFolder: string;
    imageMinSize: number;
    enableDocumentSplitting: boolean;
    documentSplittingThreshold: number;
    batchConversionBehavior: BatchConversionBehavior;
    showSuccessNotifications: boolean;
    copyTextFiles: boolean;
    createProjectConfig: boolean;
    batchDetectionWindow: number;
    deleteGeneratedOutputsBehavior: DeleteGeneratedOutputsBehavior;
}

export interface ExtensionConfiguration {
    autoConvert: boolean;
    overwriteExisting: boolean;
    organizeInSubdirectory: boolean;
    markdownSubdirectoryName: string;
    extractImages: boolean;
    imageOutputFolder: string;
    imageMinSize: number;
    enableDocumentSplitting: boolean;
    documentSplittingThreshold: number;
    batchConversionBehavior: BatchConversionBehavior;
    showSuccessNotifications: boolean;
    copyTextFiles: boolean;
    createProjectConfig: boolean;
    batchDetectionWindow: number;
    deleteGeneratedOutputsBehavior: DeleteGeneratedOutputsBehavior;
    supportedExtensions: string[];
}

export class ConfigurationManager {
    private static readonly SECTION = 'documentConverter';
    private static readonly DEFAULTS: ConfigDefaults = {
        autoConvert: true,
        overwriteExisting: true,
        organizeInSubdirectory: true,
        markdownSubdirectoryName: 'DocuGenius',
        extractImages: false,
        imageOutputFolder: 'images',
        imageMinSize: 100,
        enableDocumentSplitting: true,
        documentSplittingThreshold: 500000,
        batchConversionBehavior: 'askOnce',
        showSuccessNotifications: true,
        copyTextFiles: false,
        createProjectConfig: true,
        batchDetectionWindow: 3000,
        deleteGeneratedOutputsBehavior: 'ask'
    };
    private static readonly RESETTABLE_KEYS: readonly ConfigKey[] = [
        'autoConvert',
        'overwriteExisting',
        'organizeInSubdirectory',
        'markdownSubdirectoryName',
        'extractImages',
        'imageOutputFolder',
        'imageMinSize',
        'enableDocumentSplitting',
        'documentSplittingThreshold',
        'batchConversionBehavior',
        'showSuccessNotifications',
        'copyTextFiles',
        'createProjectConfig',
        'batchDetectionWindow',
        'deleteGeneratedOutputsBehavior'
    ];

    private getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
    }

    private getValue<K extends ConfigKey>(key: K): ConfigDefaults[K] {
        const config = this.getConfig();
        return config.get<ConfigDefaults[K]>(key, ConfigurationManager.DEFAULTS[key]);
    }

    /**
     * Check if auto-conversion is enabled
     */
    isAutoConvertEnabled(): boolean {
        return this.getValue('autoConvert');
    }

    /**
     * Check if existing files should be overwritten
     */
    shouldOverwriteExisting(): boolean {
        return this.getValue('overwriteExisting');
    }

    /**
     * Check if images should be extracted
     */
    shouldExtractImages(): boolean {
        return this.getValue('extractImages');
    }

    /**
     * Get minimum image size for extraction
     */
    getImageMinSize(): number {
        return this.getValue('imageMinSize');
    }

    /**
     * Get image output folder name
     */
    getImageOutputFolder(): string {
        return this.getValue('imageOutputFolder');
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return [...SUPPORTED_CONVERT_EXTENSIONS];
    }

    /**
     * Check if files should be organized in markdown subdirectory
     */
    shouldOrganizeInSubdirectory(): boolean {
        return this.getValue('organizeInSubdirectory');
    }

    /**
     * Check if success notifications should be shown
     */
    shouldShowSuccessNotifications(): boolean {
        return this.getValue('showSuccessNotifications');
    }

    /**
     * Check if project configuration file should be created
     */
    shouldCreateProjectConfig(): boolean {
        return this.getValue('createProjectConfig');
    }

    /**
     * Check if plain text files should be copied to knowledge base folder
     */
    shouldCopyTextFiles(): boolean {
        return this.getValue('copyTextFiles');
    }

    /**
     * Check if document splitting is enabled
     */
    isDocumentSplittingEnabled(): boolean {
        return this.getValue('enableDocumentSplitting');
    }

    /**
     * Get document splitting threshold (character count)
     */
    getDocumentSplittingThreshold(): number {
        return this.getValue('documentSplittingThreshold');
    }

    /**
     * Get batch conversion behavior setting
     */
    getBatchConversionBehavior(): BatchConversionBehavior {
        return this.getValue('batchConversionBehavior');
    }

    /**
     * Get batch detection window in milliseconds
     */
    getBatchDetectionWindow(): number {
        return this.getValue('batchDetectionWindow');
    }

    /**
     * Get delete behavior for generated outputs when a source file is deleted
     */
    getDeleteGeneratedOutputsBehavior(): DeleteGeneratedOutputsBehavior {
        return this.getValue('deleteGeneratedOutputsBehavior');
    }

    /**
     * Get the name of the subdirectory for converted files
     */
    getMarkdownSubdirectoryName(): string {
        return this.getValue('markdownSubdirectoryName');
    }

    /**
     * Update a configuration value
     */
    async updateConfiguration<K extends ConfigKey>(
        key: K,
        value: ConfigDefaults[K] | undefined,
        target?: vscode.ConfigurationTarget,
        resource?: vscode.Uri
    ): Promise<void> {
        const config = resource
            ? vscode.workspace.getConfiguration(ConfigurationManager.SECTION, resource)
            : this.getConfig();
        await config.update(key, value, target || vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Get all configuration as an object
     */
    getAllConfiguration(): ExtensionConfiguration {
        return {
            autoConvert: this.isAutoConvertEnabled(),
            overwriteExisting: this.shouldOverwriteExisting(),
            organizeInSubdirectory: this.shouldOrganizeInSubdirectory(),
            markdownSubdirectoryName: this.getMarkdownSubdirectoryName(),
            extractImages: this.shouldExtractImages(),
            imageOutputFolder: this.getImageOutputFolder(),
            imageMinSize: this.getImageMinSize(),
            enableDocumentSplitting: this.isDocumentSplittingEnabled(),
            documentSplittingThreshold: this.getDocumentSplittingThreshold(),
            batchConversionBehavior: this.getBatchConversionBehavior(),
            showSuccessNotifications: this.shouldShowSuccessNotifications(),
            copyTextFiles: this.shouldCopyTextFiles(),
            createProjectConfig: this.shouldCreateProjectConfig(),
            batchDetectionWindow: this.getBatchDetectionWindow(),
            deleteGeneratedOutputsBehavior: this.getDeleteGeneratedOutputsBehavior(),
            supportedExtensions: this.getSupportedExtensions()
        };
    }

    /**
     * Reset configuration to defaults
     */
    async resetToDefaults(): Promise<void> {
        const config = this.getConfig();
        for (const key of ConfigurationManager.RESETTABLE_KEYS) {
            await config.update(key, undefined, vscode.ConfigurationTarget.Global);
            await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
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

        // Validate numeric bounds (mirrors package.json constraints)
        const imageMinSize = this.getImageMinSize();
        if (imageMinSize < 1) {
            errors.push(`imageMinSize must be >= 1, got ${imageMinSize}`);
        }

        const threshold = this.getDocumentSplittingThreshold();
        if (threshold < 100000 || threshold > 2000000) {
            errors.push(`documentSplittingThreshold must be between 100000 and 2000000, got ${threshold}`);
        }

        const batchWindow = this.getBatchDetectionWindow();
        if (batchWindow < 1000 || batchWindow > 10000) {
            errors.push(`batchDetectionWindow must be between 1000 and 10000, got ${batchWindow}`);
        }

        // Validate non-empty string settings
        const subdirectoryName = this.getMarkdownSubdirectoryName();
        if (typeof subdirectoryName !== 'string' || !subdirectoryName.trim()) {
            errors.push('markdownSubdirectoryName must be a non-empty string');
        }

        const imageFolder = this.getImageOutputFolder();
        if (typeof imageFolder !== 'string' || !imageFolder.trim()) {
            errors.push('imageOutputFolder must be a non-empty string');
        }

        // Validate enum values
        const validBatchBehaviors: BatchConversionBehavior[] = ['askForEach', 'askOnce', 'convertAll', 'skipAll'];
        if (!validBatchBehaviors.includes(this.getBatchConversionBehavior())) {
            errors.push(`Invalid batchConversionBehavior value`);
        }

        const validDeleteBehaviors: DeleteGeneratedOutputsBehavior[] = ['ask', 'delete', 'keep'];
        if (!validDeleteBehaviors.includes(this.getDeleteGeneratedOutputsBehavior())) {
            errors.push(`Invalid deleteGeneratedOutputsBehavior value`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
