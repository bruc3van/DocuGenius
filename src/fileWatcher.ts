import * as vscode from 'vscode';
import * as path from 'path';
import { MarkitdownConverter } from './converter';
import { ConfigurationManager } from './configuration';
import { StatusManager } from './statusManager';
import { ProjectManager } from './projectManager';

export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private configChangeDisposable?: vscode.Disposable;
    private converter: MarkitdownConverter;
    private configManager: ConfigurationManager;
    private statusManager: StatusManager;
    private projectManager: ProjectManager;



    constructor(converter: MarkitdownConverter, configManager: ConfigurationManager, statusManager: StatusManager, projectManager: ProjectManager) {
        this.converter = converter;
        this.configManager = configManager;
        this.statusManager = statusManager;
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
            const copyableExtensions = [
                '.md', '.markdown', '.mdown', '.mkd', '.mkdn',  // Markdown files
                '.txt', '.text',                                // Plain text files
                '.json', '.jsonc',                             // JSON files
                '.xml', '.html', '.htm',                       // Markup files
                '.csv', '.tsv',                                // Simple data files
                '.log',                                        // Log files
                '.yaml', '.yml',                               // YAML files
                '.toml', '.ini', '.cfg', '.conf',             // Config files
                '.sql',                                        // SQL files
            ];
            allExtensions = [...supportedExtensions, ...copyableExtensions];
        }

        // Create a pattern that matches all supported extensions
        const patterns = allExtensions.map(ext => `**/*${ext}`);

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            watcher.onDidCreate(uri => this.handleFileEvent(uri, 'created'));
            watcher.onDidChange(uri => this.handleFileEvent(uri, 'changed'));
            watcher.onDidDelete(uri => this.handleFileEvent(uri, 'deleted'));

            this.watchers.push(watcher);
        }

        console.log(`File watchers initialized for ${patterns.length} patterns`);
    }



    private async handleFileEvent(uri: vscode.Uri, eventType: 'created' | 'changed' | 'deleted'): Promise<void> {
        try {
            const filePath = uri.fsPath;
            const fileName = path.basename(filePath);

            // CRITICAL: Prevent infinite loop by ignoring files in markdown directory
            const markdownSubdirName = this.configManager.getMarkdownSubdirectoryName();
            if (filePath.includes(`/${markdownSubdirName}/`) || filePath.includes(`\\${markdownSubdirName}\\`)) {
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

            const autoConvertEnabled = this.configManager.isAutoConvertEnabled();

            if (eventType === 'deleted') {
                // Handle file deletion even when auto-convert is disabled
                await this.converter.handleFileDeleted(filePath);
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

            // Add a small delay to ensure file is fully written
            await new Promise(resolve => setTimeout(resolve, 1000));

            // For file creation events, ask for user confirmation before converting
            if (eventType === 'created') {
                const shouldConvert = await this.askForConversionConfirmation(fileName, fileExtension);
                if (!shouldConvert) {
                    console.log(`User declined to convert: ${fileName}`);
                    return;
                }
            }

            // Process the file (convert or copy)
            await this.converter.processFile(filePath);

        } catch (error) {
            console.error(`Error handling file event for ${uri.fsPath}:`, error);
            vscode.window.showErrorMessage(`Failed to process file: ${path.basename(uri.fsPath)}`);
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
        const choice = await vscode.window.showInformationMessage(
            `检测到新文件: ${fileName}`,
            {
                modal: true,
                detail: `是否转换此文档为 Markdown 格式？`
            },
            '立即转换',
            '跳过',
            '禁用自动提醒'
        );

        switch (choice) {
            case '立即转换':
                return true;
            case '禁用自动提醒':
                // Disable auto-convert for current workspace only
                await this.configManager.updateConfiguration('autoConvert', false, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage('已在当前工作区禁用自动转换提醒。您可以随时在设置中重新启用。');
                return false;
            case '跳过':
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
            const copyableExtensions = [
                '.md', '.markdown', '.mdown', '.mkd', '.mkdn',  // Markdown files
                '.txt', '.text',                                // Plain text files
                '.json', '.jsonc',                             // JSON files
                '.xml', '.html', '.htm',                       // Markup files
                '.csv', '.tsv',                                // Simple data files
                '.log',                                        // Log files
                '.yaml', '.yml',                               // YAML files
                '.toml', '.ini', '.cfg', '.conf',             // Config files
                '.sql',                                        // SQL files
            ];
            return copyableExtensions.includes(fileExtension);
        }

        return false;
    }

    private isTemporaryFile(fileName: string): boolean {
        // Normalize to catch full-width characters used by some Office builds
        const normalizedName = fileName.normalize('NFKC');
        return normalizedName.startsWith('~$');
    }

    dispose(): void {
        this.disposeWatchers();
        this.configChangeDisposable?.dispose();
        this.configChangeDisposable = undefined;
    }
}
