import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ConfigurationManager } from './configuration';
import { StatusManager } from './statusManager';
import { localize } from './i18n';
import { COPYABLE_EXTENSIONS } from './constants';
import { splitByHeaders, createIndexFile } from './utils';
import { RuntimeManager, ConversionTrigger, RuntimeResolution } from './runtimeManager';
import { pathContainsDirectorySegment } from './pathUtils';

interface ConverterCommand {
    command: string;
    args: string[];
    usesPythonConverter: boolean;
    description: string;
    env?: NodeJS.ProcessEnv;
}

function runCommand(command: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            shell: false,
            env: env ? { ...process.env, ...env } : process.env
        });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`Command timeout after ${timeout / 1000}s`));
        }, timeout);

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                const failureOutput = stderr.trim() || stdout.trim();
                reject(new Error(failureOutput || `Command exited with code ${code}`));
            } else if (stderr && !stdout) {
                reject(new Error(`Command error: ${stderr}`));
            } else {
                resolve(stdout);
            }
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

export interface ConversionResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

export class MarkitdownConverter {
    private context: vscode.ExtensionContext;
    private configManager: ConfigurationManager;
    private statusManager: StatusManager;
    private runtimeManager: RuntimeManager;
    private isBatchMode: boolean = false;

    constructor(context: vscode.ExtensionContext, configManager: ConfigurationManager, statusManager: StatusManager) {
        this.context = context;
        this.configManager = configManager;
        this.statusManager = statusManager;
        this.runtimeManager = new RuntimeManager(context, statusManager);
    }

    /**
     * Process a file (convert or copy based on type)
     */
    async processFile(
        filePath: string,
        forceConvert: boolean = false,
        isBatchMode: boolean = false,
        trigger?: ConversionTrigger
    ): Promise<ConversionResult> {
        this.isBatchMode = isBatchMode;
        // CRITICAL: Prevent infinite loop - never process files in markdown directory
        const markdownSubdirName = this.configManager.getMarkdownSubdirectoryName();
        if (
            this.configManager.shouldOrganizeInSubdirectory() &&
            pathContainsDirectorySegment(filePath, markdownSubdirName)
        ) {
            console.log(`LOOP PREVENTION: Ignoring file in markdown directory: ${filePath}`);
            return { success: true, outputPath: filePath };
        }

        const fileExtension = path.extname(filePath).toLowerCase();
        const supportedExtensions = this.configManager.getSupportedExtensions();

        if (supportedExtensions.includes(fileExtension)) {
            // Convert document files
            return this.convertFile(filePath, forceConvert, trigger ?? (isBatchMode ? 'batch' : forceConvert ? 'manual' : 'auto'));
        } else if (this.configManager.shouldCopyTextFiles()) {
            // Copy text-based files only if user has enabled this option
            return this.copyFile(filePath, forceConvert);
        } else {
            // Skip processing if text file copying is disabled
            console.log(`Skipping text file (copying disabled): ${filePath}`);
            return { success: true, outputPath: filePath };
        }
    }

    /**
     * Convert a single file to Markdown
     */
    async convertFile(
        filePath: string,
        forceConvert: boolean = false,
        trigger: ConversionTrigger = forceConvert ? 'manual' : 'auto'
    ): Promise<ConversionResult> {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Check if conversion is needed (file modification time) - skip if forced
            const outputPath = this.getOutputPath(filePath);
            if (!forceConvert && !this.shouldConvert(filePath, outputPath)) {
                console.log(`Skipping conversion for ${filePath} - output is up to date`);
                return { success: true, outputPath };
            }

            const runtime = await this.runtimeManager.ensureReadyForConversion(trigger);
            if (!runtime.ready) {
                const fileName = path.basename(filePath);
                const errorMessage = runtime.error || 'Conversion runtime is not available.';
                this.statusManager.showConversionError(fileName, errorMessage);
                return {
                    success: false,
                    error: errorMessage
                };
            }

            // Show progress
            const fileName = path.basename(filePath);
            let conversionAborted = false;
            let abortMessage: string | undefined;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Converting ${fileName} ...`,
                cancellable: false
            }, async (progress) => {
                // Use message-only updates so the indicator shows continuous motion
                progress.report({ message: 'Preparing...' });

                try {
                    // Convert using built-in conversion engine
                    const markdownContent = await this.callConverter(filePath, trigger);

                    const hasContent = markdownContent.replace(/\s+/g, '').length > 0;
                    if (!hasContent) {
                        conversionAborted = true;
                        abortMessage = `无法从 ${fileName} 中提取内容。该文件可能主要由图片组成或使用了暂不支持的格式，建议先转换为 Word 等可编辑格式后再尝试。`;
                        this.statusManager.showConversionError(fileName, abortMessage);
                        vscode.window.showWarningMessage(abortMessage);
                        return;
                    }

                    progress.report({ message: 'Generating...' });

                    // Check if document splitting is needed
                    if (this.configManager.isDocumentSplittingEnabled() && 
                        markdownContent.length > this.configManager.getDocumentSplittingThreshold()) {
                        // Split the document into multiple files
                        await this.splitAndSaveDocument(outputPath, markdownContent, fileName);
                    } else {
                        // Save the markdown file as a single file
                        fs.writeFileSync(outputPath, markdownContent, 'utf8');
                    }

                    progress.report({ message: 'Finishing...' });

                    // Show success message with action buttons (if enabled and not in batch mode)
                    if (this.configManager.shouldShowSuccessNotifications() && !this.isBatchMode) {
                        vscode.window.showInformationMessage(
                            `Successfully converted ${fileName}`,
                            'Open File',
                            'Open Folder'
                        ).then(selection => {
                            if (selection === 'Open File') {
                                // Open the converted file
                                vscode.workspace.openTextDocument(outputPath).then(doc => {
                                    vscode.window.showTextDocument(doc);
                                });
                            } else if (selection === 'Open Folder') {
                                // Open the containing folder in VS Code
                                const folderUri = vscode.Uri.file(path.dirname(outputPath));
                                vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: false });
                            }
                        });
                    }
                    
                } catch (error) {
                    console.error(`Error converting ${filePath}:`, error);
                    this.statusManager.showConversionError(
                        fileName,
                        error instanceof Error ? error.message : 'Unknown error'
                    );
                    vscode.window.showErrorMessage(
                        `Failed to convert ${fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                    throw error;
                }
            });

            if (conversionAborted) {
                return {
                    success: false,
                    error: abortMessage || 'No content could be extracted from the document.'
                };
            }

            return { success: true, outputPath };

        } catch (error) {
            console.error(`Error converting file ${filePath}:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Process all supported files in a folder
     */
    async convertFolder(folderPath: string): Promise<ConversionResult[]> {
        try {
            // Find all processable files (convertible by default, copyable when enabled)
            const allExtensions = [...this.configManager.getSupportedExtensions()];
            if (this.configManager.shouldCopyTextFiles()) {
                allExtensions.push(...COPYABLE_EXTENSIONS);
            }

            const files = this.findSupportedFiles(folderPath, allExtensions);

            if (files.length === 0) {
                vscode.window.showInformationMessage('No processable files found in the selected folder.');
                return [];
            }

            const results: ConversionResult[] = [];
            const hasConvertibleFiles = files.some(file =>
                this.configManager.getSupportedExtensions().includes(path.extname(file).toLowerCase())
            );
            const runtime = hasConvertibleFiles
                ? await this.runtimeManager.ensureReadyForConversion('batch')
                : { ready: true };
            
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Converting ${files.length} files...`,
                cancellable: false
            }, async (progress) => {
                const increment = 100 / files.length;
                
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    progress.report({
                        message: `Processing ${path.basename(file)}...`
                    });

                    const fileExtension = path.extname(file).toLowerCase();
                    const isConvertible = this.configManager.getSupportedExtensions().includes(fileExtension);

                    const result = isConvertible && !runtime.ready
                        ? {
                            success: false,
                            error: runtime.error || 'Conversion runtime is not available.'
                        }
                        : await this.processFile(file, false, true, 'batch');
                    results.push(result);
                    progress.report({ increment });
                }
            });

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.length - successCount;
            
            if (failureCount === 0) {
                if (this.configManager.shouldShowSuccessNotifications()) {
                    vscode.window.showInformationMessage(
                        `Successfully processed ${successCount} files!`,
                        'Open Output Folder'
                    ).then(selection => {
                        if (selection === 'Open Output Folder') {
                            // Open the kb folder
                            const kbFolder = path.join(folderPath, this.configManager.getMarkdownSubdirectoryName());
                            if (fs.existsSync(kbFolder)) {
                                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(kbFolder));
                            }
                        }
                    });
                }
            } else {
                // Always show warnings, even if success notifications are disabled
                vscode.window.showWarningMessage(
                    `Processed ${successCount} files successfully, ${failureCount} failed.`,
                    'Open Output Folder'
                ).then(selection => {
                    if (selection === 'Open Output Folder') {
                        const kbFolder = path.join(folderPath, this.configManager.getMarkdownSubdirectoryName());
                        if (fs.existsSync(kbFolder)) {
                            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(kbFolder));
                        }
                    }
                });
            }

            return results;

        } catch (error) {
            console.error(`Error converting folder ${folderPath}:`, error);
            vscode.window.showErrorMessage(`Failed to convert folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }

    async installManagedRuntime(): Promise<RuntimeResolution> {
        return this.runtimeManager.installOrRepairRuntime(false);
    }

    async repairManagedRuntime(): Promise<RuntimeResolution> {
        return this.runtimeManager.installOrRepairRuntime(true);
    }

    async showManagedRuntimeStatus(): Promise<void> {
        await this.runtimeManager.showRuntimeStatus();
    }

    async refreshManagedRuntimeStatus(): Promise<void> {
        await this.runtimeManager.refreshStatusIndicator();
    }

    /**
     * Call built-in converter to convert file
     */
    private async callConverter(filePath: string, trigger: ConversionTrigger): Promise<string> {
        try {
            // Try embedded binary first, then fallback to system installations
            const commands = await this.getConverterCommands(trigger);

            let lastError: Error | null = null;

            for (const converterCommand of commands) {
                try {
                    let args = [...converterCommand.args];

                    if (converterCommand.usesPythonConverter) {
                        // Pass extract images configuration to Python converter
                        const extractImages = this.configManager.shouldExtractImages();
                        const outputPath = this.getOutputPath(filePath);
                        args.push(filePath, extractImages ? 'true' : 'false', outputPath);
                    } else {
                        args.push(filePath);
                    }

                    // Add timeout for Windows to prevent hanging
                    const timeout = process.platform === 'win32' ? 120000 : 180000; // 2min for Windows, 3min for others

                    const stdout = await runCommand(converterCommand.command, args, timeout, converterCommand.env);

                    // Process the markdown content to handle images if needed
                    let markdownContent = stdout;

                    if (this.configManager.shouldExtractImages() && !converterCommand.usesPythonConverter) {
                        // Only do additional image processing if we didn't use Python converter
                        // Python converter already includes intelligent image extraction
                        markdownContent = await this.processImages(filePath, markdownContent);
                    }

                    return markdownContent;

                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    console.log(`Command failed: ${converterCommand.description}, Error: ${lastError.message}`);
                    continue; // Try next command
                }
            }

            // If all commands failed, throw helpful error
            const hasBuiltInConverter = process.platform === 'win32'
                ? fs.existsSync(this.context.asAbsolutePath('bin/converter.py'))
                : fs.existsSync(this.context.asAbsolutePath(`bin/${process.platform}/docugenius-cli`));

            if (hasBuiltInConverter) {
                const troubleshooting = process.platform === 'win32'
                    ? `Windows built-in Python converter failed to execute. This is usually caused by:\n\n` +
                      `1. Python is not installed or not in PATH\n` +
                      `2. Required Python packages could not be installed\n` +
                      `3. File path or permission issues\n\n`
                    : `Embedded converter binary failed to execute. This might be due to:\n\n` +
                      `1. Missing system libraries\n` +
                      `2. Architecture mismatch\n` +
                      `3. Permission issues\n\n`;

                throw new Error(
                    troubleshooting +
                    `Last error: ${lastError?.message || 'Unknown error'}`
                );
            } else {
                throw new Error(
                    `Built-in converter is not available. Please check the extension installation.\n\n` +
                    `Last error: ${lastError?.message || 'Unknown error'}`
                );
            }

        } catch (error) {
            throw error;
        }
    }



    /**
     * Get output path for converted/copied file
     */
    private getOutputPath(filePath: string): string {
        const dir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();

        if (this.configManager.shouldOrganizeInSubdirectory()) {
            // Create a subdirectory for processed files
            const subdirName = this.configManager.getMarkdownSubdirectoryName();
            const markdownDir = path.join(dir, subdirName);

            // Ensure the markdown directory exists
            if (!fs.existsSync(markdownDir)) {
                fs.mkdirSync(markdownDir, { recursive: true });
            }

            // For files that need conversion, use .md extension
            const supportedExtensions = this.configManager.getSupportedExtensions();
            if (supportedExtensions.includes(fileExtension)) {
                const nameWithoutExt = path.parse(fileName).name;
                return path.join(markdownDir, `${nameWithoutExt}.md`);
            } else {
                // For files that are just copied, keep original extension
                return path.join(markdownDir, fileName);
            }
        } else {
            // Keep files in the same directory
            const supportedExtensions = this.configManager.getSupportedExtensions();
            if (supportedExtensions.includes(fileExtension)) {
                const nameWithoutExt = path.parse(fileName).name;
                return path.join(dir, `${nameWithoutExt}.md`);
            } else {
                // For copied files, add a suffix to avoid conflicts
                const nameWithoutExt = path.parse(fileName).name;
                const ext = path.parse(fileName).ext;
                return path.join(dir, `${nameWithoutExt}_copy${ext}`);
            }
        }
    }

    /**
     * Check if conversion is needed
     */
    private shouldConvert(inputPath: string, outputPath: string): boolean {
        // If output doesn't exist, convert
        if (!fs.existsSync(outputPath)) {
            return true;
        }

        // If overwrite is disabled, skip
        if (!this.configManager.shouldOverwriteExisting()) {
            return false;
        }

        // Check modification times
        const inputStat = fs.statSync(inputPath);
        const outputStat = fs.statSync(outputPath);
        
        return inputStat.mtime > outputStat.mtime;
    }

    /**
     * Find all supported files in a directory
     */
    private findSupportedFiles(dirPath: string, supportedExtensions: string[]): string[] {
        const files: string[] = [];
        const markdownSubdirName = this.configManager.getMarkdownSubdirectoryName().toLowerCase();
        const shouldSkipOutputDirectory = this.configManager.shouldOrganizeInSubdirectory();
        
        const scanDirectory = (currentPath: string) => {
            const items = fs.readdirSync(currentPath);
            
            for (const item of items) {
                const itemPath = path.join(currentPath, item);
                const stat = fs.statSync(itemPath);
                
                if (stat.isDirectory()) {
                    if (shouldSkipOutputDirectory && item.toLowerCase() === markdownSubdirName) {
                        continue;
                    }
                    scanDirectory(itemPath);
                } else if (stat.isFile()) {
                    // Skip DocuGenius configuration files
                    if (item === '.docugenius.json' || item === '.docugenius.example.json') {
                        continue;
                    }
                    
                    const ext = path.extname(item).toLowerCase();
                    if (supportedExtensions.includes(ext)) {
                        files.push(itemPath);
                    }
                }
            }
        };
        
        scanDirectory(dirPath);
        return files;
    }

    /**
     * Get available converter commands in order of preference
     */
    private async getConverterCommands(trigger: ConversionTrigger): Promise<ConverterCommand[]> {
        const platform = process.platform;
        const commands: ConverterCommand[] = [];

        if (platform === 'win32') {
            const embeddedConverterPath = this.context.asAbsolutePath('bin/converter.py');
            const runtime = await this.runtimeManager.ensureReadyForConversion(this.isBatchMode ? 'batch' : trigger);

            if (fs.existsSync(embeddedConverterPath) && runtime.ready && runtime.pythonPath) {
                commands.push({
                    command: runtime.pythonPath,
                    args: [embeddedConverterPath],
                    usesPythonConverter: true,
                    description: `${runtime.pythonPath} ${embeddedConverterPath}`,
                    env: {
                        DOCUGENIUS_AUTO_INSTALL_DEPS: '0'
                    }
                });
            }

            return commands;
        }

        // Simple approach: use platform-specific binary
        const embeddedBinaryPath = this.context.asAbsolutePath(`bin/${platform}/docugenius-cli`);

        if (fs.existsSync(embeddedBinaryPath)) {
            commands.push({
                command: embeddedBinaryPath,
                args: [],
                usesPythonConverter: false,
                description: embeddedBinaryPath
            });
        }

        return commands;
    }

    /**
     * Copy a text-based file to the markdown directory
     */
    async copyFile(filePath: string, forceConvert: boolean = false): Promise<ConversionResult> {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const outputPath = this.getOutputPath(filePath);

            // Check if copy is needed (file modification time) - skip if forced
            if (!forceConvert && !this.shouldConvert(filePath, outputPath)) {
                console.log(`Skipping copy for ${filePath} - output is up to date`);
                return { success: true, outputPath };
            }

            // Show progress
            const fileName = path.basename(filePath);
            this.statusManager.showConversionInProgress(fileName);

            // Copy the file
            const fileContent = fs.readFileSync(filePath, 'utf8');
            fs.writeFileSync(outputPath, fileContent, 'utf8');

            // Show success message (suppress notification in batch mode)
            this.statusManager.showConversionSuccess(filePath, outputPath, this.isBatchMode);
            this.statusManager.log(`✓ Copied: ${fileName} → ${path.basename(outputPath)}`);

            return { success: true, outputPath };

        } catch (error) {
            console.error(`Error copying file ${filePath}:`, error);
            const fileName = path.basename(filePath);
            this.statusManager.showConversionError(fileName, error instanceof Error ? error.message : 'Unknown error');
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Handle file deletion - clean up corresponding markdown file and assets
     */
    async handleFileDeleted(filePath: string): Promise<void> {
        try {
            const fileName = path.basename(filePath);
            console.log(`Handling deletion of: ${fileName}`);

            // Get the corresponding output path
            const outputPath = this.getOutputPath(filePath);

            // Delete the markdown file if it exists
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
                console.log(`Deleted corresponding markdown file: ${outputPath}`);
                this.statusManager.log(`🗑️ Deleted: ${path.basename(outputPath)} (source file ${fileName} was deleted)`);
            }

            // Delete images folder if it exists (consistent with Python image extractor)
            const originalDir = path.dirname(filePath);
            const originalBaseName = path.parse(fileName).name;

            let imagesDir: string;
            if (this.configManager.shouldOrganizeInSubdirectory()) {
                const subdirName = this.configManager.getMarkdownSubdirectoryName();
                const markdownDir = path.join(originalDir, subdirName);
                imagesDir = path.join(markdownDir, 'images', originalBaseName);
            } else {
                imagesDir = path.join(originalDir, 'images', originalBaseName);
            }

            if (fs.existsSync(imagesDir)) {
                fs.rmSync(imagesDir, { recursive: true, force: true });
                console.log(`Deleted images folder: ${imagesDir}`);
                this.statusManager.log(`🗑️ Deleted images: images/${originalBaseName}/`);
            }

            // Also clean up legacy assets folder if it exists
            let legacyAssetsDir: string;
            if (this.configManager.shouldOrganizeInSubdirectory()) {
                const subdirName = this.configManager.getMarkdownSubdirectoryName();
                const markdownDir = path.join(originalDir, subdirName);
                legacyAssetsDir = path.join(markdownDir, `${originalBaseName}_assets`);
            } else {
                legacyAssetsDir = path.join(originalDir, `${originalBaseName}_assets`);
            }

            if (fs.existsSync(legacyAssetsDir)) {
                fs.rmSync(legacyAssetsDir, { recursive: true, force: true });
                console.log(`Deleted legacy assets folder: ${legacyAssetsDir}`);
                this.statusManager.log(`🗑️ Deleted legacy assets: ${originalBaseName}_assets/`);
            }

            // Show status update
            this.statusManager.updateStatusBar(`🗑️ Cleaned up ${fileName}`, `Deleted markdown file and assets for ${fileName}`);

            // Reset status bar after 3 seconds
            setTimeout(() => {
                this.statusManager.updateStatusBar(localize('status.ready'));
            }, 3000);

        } catch (error) {
            console.error(`Error handling file deletion for ${filePath}:`, error);
            this.statusManager.log(`Error cleaning up deleted file ${path.basename(filePath)}: ${error}`);
        }
    }

    /**
     * Enhanced image processing with actual image extraction
     */
    private async processImages(originalFilePath: string, markdownContent: string): Promise<string> {
        try {
            const fileExtension = path.extname(originalFilePath).toLowerCase();

            // Check if image extraction is enabled
            if (!this.configManager.shouldExtractImages()) {
                // If image extraction is disabled, just process existing image references
                return this.processExistingImageReferences(originalFilePath, markdownContent);
            }

            // Only extract images from supported document types
            if (!['.pdf', '.docx', '.pptx', '.xlsx'].includes(fileExtension)) {
                // For other files, just process existing image references
                return this.processExistingImageReferences(originalFilePath, markdownContent);
            }

            // Try to extract images using the image extractor
            let imageExtractionResult: any = null;

            try {
                imageExtractionResult = await this.extractImagesFromDocument(originalFilePath);
            } catch (error) {
                console.warn(`Warning: Image extraction failed for ${originalFilePath}:`, error);
                // Continue with processing existing references
            }

            // Check if we have intelligent extraction result with full content
            if (imageExtractionResult && imageExtractionResult.success && imageExtractionResult.markdown_content) {
                // Use the intelligent extraction result that has images in original positions
                let intelligentContent = imageExtractionResult.markdown_content;

                // Process any existing image references in the intelligent content
                intelligentContent = await this.processExistingImageReferences(originalFilePath, intelligentContent);

                return intelligentContent;
            } else {
                // No intelligent extraction result, just process existing image references
                // The Python backend (converter.py) already handles fallback to traditional extraction
                // and will include images inline without the "## Extracted Images" header
                let processedContent = await this.processExistingImageReferences(originalFilePath, markdownContent);
                return processedContent;
            }

        } catch (error) {
            console.warn(`Warning: Could not process images for ${originalFilePath}:`, error);
            return markdownContent; // Return original content if image processing fails
        }
    }

    /**
     * Extract images from document using the Python image extractor
     */
    private async extractImagesFromDocument(filePath: string): Promise<any> {
        try {
            const platform = process.platform;
            const imageExtractorPath = this.context.asAbsolutePath(`bin/${platform}/image_extractor.py`);

            // Check if image extractor exists
            if (!fs.existsSync(imageExtractorPath)) {
                console.warn(`Image extractor not found at: ${imageExtractorPath}`);
                return null;
            }

            // Determine output directory based on configuration
            const originalDir = path.dirname(filePath);
            const imageOutputFolder = this.configManager.getImageOutputFolder();
            let outputDir: string;
            let markdownDir: string;

            if (this.configManager.shouldOrganizeInSubdirectory()) {
                const subdirName = this.configManager.getMarkdownSubdirectoryName();
                markdownDir = path.join(originalDir, subdirName);
                outputDir = path.join(markdownDir, imageOutputFolder);
            } else {
                markdownDir = originalDir;
                outputDir = path.join(originalDir, imageOutputFolder);
            }

            // Get minimum image size from configuration
            const minImageSize = this.configManager.getImageMinSize();

            // Call the intelligent image extractor with full content extraction
            const args = [imageExtractorPath, filePath, outputDir, markdownDir, 'full_content', String(minImageSize)];

            // Add timeout for image extraction
            const timeout = process.platform === 'win32' ? 120000 : 180000; // 2min for Windows, 3min for others

            const stdout = await runCommand('python', args, timeout);

            // Parse JSON result
            const result = JSON.parse(stdout);
            return result;

        } catch (error) {
            console.warn(`Warning: Failed to extract images from ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Process existing image references in markdown content (legacy functionality)
     */
    private async processExistingImageReferences(originalFilePath: string, markdownContent: string): Promise<string> {
        try {
            const originalDir = path.dirname(originalFilePath);
            const originalBaseName = path.parse(path.basename(originalFilePath)).name;

            // First check if there are any images in the markdown content
            const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            const hasImages = imageRegex.test(markdownContent);

            if (!hasImages) {
                // No images found, return content as-is without creating assets folder
                return markdownContent;
            }

            let imagesDir: string;

            if (this.configManager.shouldOrganizeInSubdirectory()) {
                // Create images directory in the subdirectory (consistent with Python extractor)
                const subdirName = this.configManager.getMarkdownSubdirectoryName();
                const markdownDir = path.join(originalDir, subdirName);
                imagesDir = path.join(markdownDir, 'images', originalBaseName);
            } else {
                // Create images directory in the same location as the original file
                imagesDir = path.join(originalDir, 'images', originalBaseName);
            }

            // Create images directory only when we have images
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }

            // Process image references in markdown
            // Reset regex for processing (reuse the same regex variable)
            imageRegex.lastIndex = 0; // Reset regex state
            let processedContent = markdownContent;
            let match;

            while ((match = imageRegex.exec(markdownContent)) !== null) {
                const [fullMatch, altText, imagePath] = match;

                // If image path is not already relative to images folder, update it
                if (!imagePath.startsWith(`images/${originalBaseName}/`)) {
                    const imageName = path.basename(imagePath);
                    const newImagePath = `images/${originalBaseName}/${imageName}`;
                    processedContent = processedContent.replace(fullMatch, `![${altText}](${newImagePath})`);
                }
            }

            return processedContent;

        } catch (error) {
            console.warn(`Warning: Could not process existing image references for ${originalFilePath}:`, error);
            return markdownContent;
        }
    }

    /**
     * Split large document into multiple markdown files
     */
    private async splitAndSaveDocument(outputPath: string, markdownContent: string, originalFileName: string): Promise<void> {
        const threshold = this.configManager.getDocumentSplittingThreshold();
        const parts: string[] = [];
        
        // Split content by sections (headers) first, then by character count if needed
        const sections = splitByHeaders(markdownContent);
        let currentPart = '';
        
        for (const section of sections) {
            // If adding this section would exceed threshold, save current part
            if (currentPart.length > 0 && (currentPart.length + section.length) > threshold) {
                parts.push(currentPart.trim());
                currentPart = section;
            } else {
                currentPart += section;
            }
        }
        
        // Add the last part
        if (currentPart.trim().length > 0) {
            parts.push(currentPart.trim());
        }
        
        // If we only have one part, save as original file
        if (parts.length <= 1) {
            fs.writeFileSync(outputPath, markdownContent, 'utf8');
            return;
        }
        
        // Save multiple parts
        const dir = path.dirname(outputPath);
        const baseName = path.basename(outputPath, '.md');
        
        for (let i = 0; i < parts.length; i++) {
            const partFileName = `${baseName}_part${i + 1}.md`;
            const partPath = path.join(dir, partFileName);
            
            // Add header to each part indicating it's part of a larger document
            const partContent = `# ${originalFileName} - Part ${i + 1} of ${parts.length}\n\n${parts[i]}`;
            fs.writeFileSync(partPath, partContent, 'utf8');
        }
        
        // Create an index file
        const indexContent = createIndexFile(originalFileName, parts.length, baseName);
        const indexPath = path.join(dir, `${baseName}_index.md`);
        fs.writeFileSync(indexPath, indexContent, 'utf8');
    }
    
}
