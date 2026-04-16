import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DeletionCleanupPlan, MarkitdownConverter } from './converter';
import { ConfigurationManager, DeleteGeneratedOutputsBehavior } from './configuration';
import { ProjectManager } from './projectManager';
import { COPYABLE_EXTENSIONS } from './constants';
import { pathContainsDirectorySegment } from './pathUtils';
import { localize } from './i18n';

type FileEventType = 'created' | 'changed' | 'deleted';

interface PendingCreatedFile {
    filePath: string;
    fileName: string;
    fileExtension: string;
}

export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private configChangeDisposable?: vscode.Disposable;
    private converter: MarkitdownConverter;
    private configManager: ConfigurationManager;
    private projectManager: ProjectManager;
    private pendingCreatedFiles = new Map<string, PendingCreatedFile>();
    private pendingBatchTimer?: NodeJS.Timeout;

    constructor(converter: MarkitdownConverter, configManager: ConfigurationManager, projectManager: ProjectManager) {
        this.converter = converter;
        this.configManager = configManager;
        this.projectManager = projectManager;
        this.initializeWatchers();

        // Listen for configuration changes
        this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('documentConverter')) {
                this.reinitializeWatchers();
            }
        });
    }

    private initializeWatchers(): void {
        // Dispose existing watchers
        this.disposeWatchers();

        const projectEnabled = this.projectManager.isProjectEnabled();
        if (!projectEnabled) {
            console.log('File watcher disabled - project not enabled for DocuGenius');
            return;
        }

        const autoConvertEnabled = this.configManager.isAutoConvertEnabled();
        if (autoConvertEnabled) {
            console.log('Initializing file watchers for auto-conversion');
        } else {
            console.log('Initializing file watchers for cleanup only (auto-convert disabled)');
        }

        // Create watchers for supported file types
        const supportedExtensions = this.configManager.getSupportedExtensions();
        let allExtensions = [...supportedExtensions];

        // Only add copyable extensions if user has enabled text file copying
        if (this.configManager.shouldCopyTextFiles()) {
            allExtensions = [...supportedExtensions, ...COPYABLE_EXTENSIONS];
        }

        // Create a single glob pattern that matches all supported extensions
        const extList = allExtensions.map(ext => ext.substring(1)).join(',');
        const pattern = `**/*.{${extList}}`;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate(uri => this.handleFileEvent(uri, 'created'));
        watcher.onDidChange(uri => this.handleFileEvent(uri, 'changed'));
        watcher.onDidDelete(uri => this.handleFileEvent(uri, 'deleted'));

        this.watchers.push(watcher);

        console.log(`File watcher initialized for pattern: ${pattern}`);
    }



    private async handleFileEvent(uri: vscode.Uri, eventType: FileEventType): Promise<void> {
        try {
            const filePath = uri.fsPath;
            const fileName = path.basename(filePath);

            // CRITICAL: Prevent infinite loop by ignoring files in markdown directory
            const markdownSubdirName = this.configManager.getMarkdownSubdirectoryName();
            if (
                this.configManager.shouldOrganizeInSubdirectory() &&
                pathContainsDirectorySegment(filePath, markdownSubdirName)
            ) {
                console.log(`Ignoring file in markdown directory: ${filePath}`);
                return;
            }

            // Ignore DocuGenius configuration files
            if (fileName === '.docugenius.json' || fileName === '.docugenius.example.json') {
                console.log(`Ignoring DocuGenius configuration file: ${filePath}`);
                return;
            }

            // Ignore temporary files created by Office (e.g. "~$-Document.docx")
            if (this.isTemporaryFile(fileName)) {
                console.log(`Ignoring temporary file: ${filePath}`);
                return;
            }

            const projectEnabled = this.projectManager.isProjectEnabled();
            if (!projectEnabled) {
                console.log(`Ignoring file event (project disabled): ${filePath}`);
                return;
            }

            const autoConvertEnabled = this.isAutoConvertEnabled();

            if (eventType === 'deleted') {
                // Handle file deletion even when auto-convert is disabled
                const cleanupPlan = this.converter.getDeletionCleanupPlan(filePath);
                if (!cleanupPlan.hasCleanupTargets) {
                    return;
                }

                const shouldDeleteGeneratedOutputs = await this.shouldDeleteGeneratedOutputs(uri, fileName, cleanupPlan);
                if (shouldDeleteGeneratedOutputs) {
                    await this.converter.handleFileDeleted(filePath, cleanupPlan);
                }
                return;
            }

            if (eventType === 'changed' && this.pendingCreatedFiles.has(filePath)) {
                console.log(`Skipping change event because create event is already queued: ${filePath}`);
                return;
            }

            if (!autoConvertEnabled) {
                console.log(`Auto-convert disabled - skipping ${eventType} event for ${fileName}`);
                return;
            }

            // Handle file creation/change
            const fileExtension = path.extname(filePath).toLowerCase();

            // Check if this extension should be processed (either for conversion or copying)
            if (!this.shouldProcessFile(fileExtension)) {
                return;
            }

            if (eventType === 'created') {
                this.queueCreatedFile(filePath, fileName, fileExtension);
                return;
            }

            // Add a small delay to ensure file is fully written
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Process the file (convert or copy)
            await this.converter.processFile(filePath);

        } catch (error) {
            console.error(`Error handling file event for ${uri.fsPath}:`, error);
            vscode.window.showErrorMessage(localize('fileWatcher.error.processFileFailed', path.basename(uri.fsPath)));
        }
    }

    /**
     * Ask user for confirmation before converting a newly created file
     */
    private async askForConversionConfirmation(fileName: string, fileExtension: string): Promise<boolean> {
        // Check if this is a convertible document (not just a copyable file)
        const supportedExtensions = this.configManager.getSupportedExtensions();
        const isConvertibleDocument = supportedExtensions.includes(fileExtension);

        if (!isConvertibleDocument) {
            // For copyable files (like .md, .txt), don't ask for confirmation
            return true;
        }

        // Ask for confirmation for document conversion
        const convertNowLabel = localize('fileWatcher.action.convertNow');
        const skipLabel = localize('fileWatcher.action.skip');
        const disableAutoConvertLabel = localize('fileWatcher.action.disableAutoConvert');
        const choice = await vscode.window.showInformationMessage(
            localize('fileWatcher.prompt.singleTitle', fileName),
            {
                modal: true,
                detail: localize('fileWatcher.prompt.singleDetail')
            },
            convertNowLabel,
            skipLabel,
            disableAutoConvertLabel
        );

        switch (choice) {
            case convertNowLabel:
                return true;
            case disableAutoConvertLabel:
                // Disable auto-convert for current workspace only
                await this.configManager.updateConfiguration('autoConvert', false, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(localize('fileWatcher.info.autoConvertDisabled'));
                return false;
            case skipLabel:
            default:
                return false;
        }
    }

    private async askForBatchConversionConfirmation(files: PendingCreatedFile[]): Promise<boolean> {
        const documentCount = files.filter(file => this.isConvertibleDocument(file.fileExtension)).length;
        if (documentCount === 0) {
            return true;
        }

        const convertAllLabel = localize('fileWatcher.action.convertAll');
        const skipAllLabel = localize('fileWatcher.action.skipAll');
        const disableAutoConvertLabel = localize('fileWatcher.action.disableAutoConvert');
        const choice = await vscode.window.showInformationMessage(
            localize('fileWatcher.prompt.batchTitle', files.length),
            {
                modal: true,
                detail: localize(
                    documentCount === 1
                        ? 'fileWatcher.prompt.batchDetailSingle'
                        : 'fileWatcher.prompt.batchDetailPlural',
                    documentCount
                )
            },
            convertAllLabel,
            skipAllLabel,
            disableAutoConvertLabel
        );

        switch (choice) {
            case convertAllLabel:
                return true;
            case disableAutoConvertLabel:
                await this.configManager.updateConfiguration('autoConvert', false, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(localize('fileWatcher.info.autoConvertDisabled'));
                return false;
            case skipAllLabel:
            default:
                return false;
        }
    }

    private reinitializeWatchers(): void {
        console.log('Reinitializing file watchers due to configuration change');
        this.initializeWatchers();
    }

    private disposeWatchers(): void {
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers = [];
    }

    /**
     * Check if a file should be processed (either converted or copied)
     */
    private shouldProcessFile(fileExtension: string): boolean {
        // Process files that need conversion
        const supportedExtensions = this.configManager.getSupportedExtensions();
        if (supportedExtensions.includes(fileExtension)) {
            return true;
        }

        // Only process copyable files if user has enabled text file copying
        if (this.configManager.shouldCopyTextFiles()) {
            return COPYABLE_EXTENSIONS.includes(fileExtension);
        }

        return false;
    }

    private isTemporaryFile(fileName: string): boolean {
        // Normalize to catch full-width characters used by some Office builds
        const normalizedName = fileName.normalize('NFKC');
        return normalizedName.startsWith('~$');
    }

    private isConvertibleDocument(fileExtension: string): boolean {
        return this.configManager.getSupportedExtensions().includes(fileExtension);
    }

    private isAutoConvertEnabled(): boolean {
        const projectAutoConvert = this.projectManager.getProjectAutoConvert();
        return projectAutoConvert ?? this.configManager.isAutoConvertEnabled();
    }

    private async shouldDeleteGeneratedOutputs(
        uri: vscode.Uri,
        fileName: string,
        cleanupPlan: DeletionCleanupPlan
    ): Promise<boolean> {
        const deleteBehavior = this.configManager.getDeleteGeneratedOutputsBehavior();

        switch (deleteBehavior) {
            case 'delete':
                return true;
            case 'keep':
                return false;
            case 'ask':
            default:
                return this.askForDeletionCleanupConfirmation(uri, fileName, cleanupPlan);
        }
    }

    private async askForDeletionCleanupConfirmation(
        uri: vscode.Uri,
        fileName: string,
        cleanupPlan: DeletionCleanupPlan
    ): Promise<boolean> {
        const deleteThisTimeLabel = localize('fileWatcher.action.deleteThisTime');
        const alwaysDeleteLabel = localize('fileWatcher.action.alwaysDeleteGenerated');
        const keepGeneratedLabel = localize('fileWatcher.action.keepGenerated');
        const generatedFileCount = cleanupPlan.outputFiles.length;
        const generatedDirectoryCount = cleanupPlan.directories.length;

        const choice = await vscode.window.showWarningMessage(
            localize('fileWatcher.prompt.deleteGeneratedTitle', fileName),
            {
                modal: true,
                detail: localize(
                    'fileWatcher.prompt.deleteGeneratedDetail',
                    generatedFileCount,
                    generatedDirectoryCount
                )
            },
            deleteThisTimeLabel,
            alwaysDeleteLabel,
            keepGeneratedLabel
        );

        switch (choice) {
            case alwaysDeleteLabel:
                await this.persistDeleteGeneratedOutputsBehavior(uri, 'delete');
                vscode.window.showInformationMessage(localize('fileWatcher.info.deleteGeneratedAlways'));
                return true;
            case deleteThisTimeLabel:
                return true;
            case keepGeneratedLabel:
                await this.persistDeleteGeneratedOutputsBehavior(uri, 'keep');
                vscode.window.showInformationMessage(localize('fileWatcher.info.keepGeneratedAlways'));
                return false;
            default:
                return false;
        }
    }

    private async persistDeleteGeneratedOutputsBehavior(
        uri: vscode.Uri,
        behavior: DeleteGeneratedOutputsBehavior
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const target = workspaceFolder
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : vscode.ConfigurationTarget.Workspace;

        await this.configManager.updateConfiguration(
            'deleteGeneratedOutputsBehavior',
            behavior,
            target,
            uri
        );
    }

    private queueCreatedFile(filePath: string, fileName: string, fileExtension: string): void {
        this.pendingCreatedFiles.set(filePath, {
            filePath,
            fileName,
            fileExtension
        });
        this.schedulePendingBatchFlush();
    }

    private schedulePendingBatchFlush(): void {
        if (this.pendingBatchTimer) {
            clearTimeout(this.pendingBatchTimer);
        }

        this.pendingBatchTimer = setTimeout(() => {
            this.pendingBatchTimer = undefined;
            void this.flushPendingCreatedFiles();
        }, this.configManager.getBatchDetectionWindow());
    }

    private async flushPendingCreatedFiles(): Promise<void> {
        const queuedFiles = [...this.pendingCreatedFiles.values()];
        this.pendingCreatedFiles.clear();

        if (queuedFiles.length === 0) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        const existingFiles = queuedFiles.filter(file => fs.existsSync(file.filePath));
        if (existingFiles.length === 0) {
            return;
        }

        const behavior = this.configManager.getBatchConversionBehavior();
        if (behavior === 'skipAll') {
            return;
        }

        if (behavior === 'convertAll') {
            await this.processCreatedFiles(existingFiles);
            return;
        }

        if (behavior === 'askOnce' && existingFiles.length > 1) {
            const shouldConvert = await this.askForBatchConversionConfirmation(existingFiles);
            if (shouldConvert) {
                await this.processCreatedFiles(existingFiles);
            }
            return;
        }

        await this.processCreatedFilesIndividually(existingFiles);
    }

    private async processCreatedFiles(files: PendingCreatedFile[]): Promise<void> {
        for (const file of files) {
            await this.converter.processFile(file.filePath);
        }
    }

    private async processCreatedFilesIndividually(files: PendingCreatedFile[]): Promise<void> {
        for (const file of files) {
            if (!fs.existsSync(file.filePath)) {
                continue;
            }

            if (this.isConvertibleDocument(file.fileExtension)) {
                const shouldConvert = await this.askForConversionConfirmation(file.fileName, file.fileExtension);
                if (!shouldConvert) {
                    console.log(`User declined to convert: ${file.fileName}`);
                    continue;
                }
            }

            await this.converter.processFile(file.filePath);
        }
    }

    private clearPendingBatchState(): void {
        if (this.pendingBatchTimer) {
            clearTimeout(this.pendingBatchTimer);
            this.pendingBatchTimer = undefined;
        }

        this.pendingCreatedFiles.clear();
    }

    dispose(): void {
        this.disposeWatchers();
        this.configChangeDisposable?.dispose();
        this.configChangeDisposable = undefined;
        this.clearPendingBatchState();
    }
}
