import * as vscode from 'vscode';
import { FileWatcher } from './fileWatcher';
import { MarkitdownConverter } from './converter';
import { ConfigurationManager } from './configuration';
import { StatusManager } from './statusManager';
import { ProjectManager } from './projectManager';
import { I18nManager, getMessage, getStatusText } from './i18n';

let fileWatcher: FileWatcher | undefined;
let statusManager: StatusManager | undefined;
let projectManager: ProjectManager | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('DocuGenius is now active!');

    // Initialize i18n manager
    I18nManager.getInstance(context.extensionPath);

    // Initialize project manager
    projectManager = new ProjectManager();

    // Initialize configuration manager
    const configManager = new ConfigurationManager();

    // Initialize status manager
    statusManager = new StatusManager(configManager);

    // Initialize converter
    const converter = new MarkitdownConverter(context, configManager, statusManager);

    const detachFileWatcher = (): void => {
        if (!fileWatcher) {
            return;
        }

        const watcherIndex = context.subscriptions.indexOf(fileWatcher);
        if (watcherIndex >= 0) {
            context.subscriptions.splice(watcherIndex, 1);
        }

        fileWatcher.dispose();
        fileWatcher = undefined;
    };

    const attachFileWatcher = (): void => {
        detachFileWatcher();
        if (!projectManager) {
            return;
        }

        fileWatcher = new FileWatcher(converter, configManager, projectManager);
        context.subscriptions.push(fileWatcher);
    };

    // Initialize file watcher
    attachFileWatcher();
    
    // Helper to get effective auto-convert setting
    const getEffectiveAutoConvert = (): boolean => {
        if (!projectManager) {
            return configManager.isAutoConvertEnabled();
        }

        const projectAutoConvert = projectManager.getProjectAutoConvert();
        if (projectAutoConvert !== undefined) {
            return projectAutoConvert;
        }
        return configManager.isAutoConvertEnabled();
    };

    // Check if we should show enable prompt for new projects
    if (projectManager && !projectManager.isProjectEnabled()) {
        setTimeout(() => {
            if (projectManager?.shouldShowEnablePrompt()) {
                projectManager.showEnableDialog().then(enabled => {
                    if (enabled && statusManager && projectManager) {
                        // Reinitialize file watcher when project is enabled
                        attachFileWatcher();
                        statusManager.showWatcherStatus(getEffectiveAutoConvert(), configManager.getSupportedExtensions());
                    }
                });
            }
        }, 2000); // 延迟2秒，避免启动时过于突兀
    }
    
    // Register commands
    const convertFileCommand = vscode.commands.registerCommand('documentConverter.convertFile', async (uri: vscode.Uri) => {
        if (uri && uri.fsPath) {
            // Force conversion for manual command to ensure fresh conversion
            await converter.processFile(uri.fsPath, true);
        } else {
            // If no URI provided, ask user to select a file
            // Build file filters based on settings
            const supportedExtensions = configManager.getSupportedExtensions().map(ext => ext.substring(1)); // Remove leading dot
            let allExtensions = [...supportedExtensions];

            if (configManager.shouldCopyTextFiles()) {
                const textExtensions = ['txt', 'md', 'markdown', 'json', 'xml', 'html', 'csv', 'yaml', 'sql'];
                allExtensions = [...supportedExtensions, ...textExtensions];
            }

            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'All Supported Files': allExtensions
                }
            });

            if (fileUri && fileUri[0]) {
                // Force conversion for manual selection
                await converter.processFile(fileUri[0].fsPath, true);
            }
        }
    });


    const convertFolderCommand = vscode.commands.registerCommand('documentConverter.convertFolder', async (uri: vscode.Uri) => {
        if (uri && uri.fsPath) {
            await converter.convertFolder(uri.fsPath);
        } else {
            // If no URI provided, ask user to select a folder
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false
            });

            if (folderUri && folderUri[0]) {
                await converter.convertFolder(folderUri[0].fsPath);
            }
        }
    });

    // Project management commands
    const enableProjectCommand = vscode.commands.registerCommand('documentConverter.enableProject', async () => {
        if (!projectManager || !statusManager) return;

        const enabled = await projectManager.enableForProject(undefined, true);
        if (enabled) {
            // Reinitialize file watcher when project is enabled
            attachFileWatcher();
            statusManager.showWatcherStatus(getEffectiveAutoConvert(), configManager.getSupportedExtensions());
        }
    });

    const disableProjectCommand = vscode.commands.registerCommand('documentConverter.disableProject', async () => {
        if (!projectManager || !statusManager) return;
        
        await projectManager.disableForProject();
        detachFileWatcher();
        statusManager.showWatcherStatus(false, []);
    });

    const showProjectStatusCommand = vscode.commands.registerCommand('documentConverter.showProjectStatus', () => {
        if (!projectManager) return;
        
        const isEnabled = projectManager.isProjectEnabled();
        const configPath = projectManager.getConfigFilePath();

        const statusText = isEnabled ? getMessage('projectStatus.enabled') : getMessage('projectStatus.disabled');
        const configText = configPath || getMessage('projectStatus.notExists');

        vscode.window.showInformationMessage(
            getMessage('projectStatus.info', statusText, configText),
            isEnabled ? getMessage('disableProject') : getMessage('enableProject'),
            getMessage('openConfigFile')
        ).then(choice => {
            if (choice === getMessage('enableProject')) {
                vscode.commands.executeCommand('documentConverter.enableProject');
            } else if (choice === getMessage('disableProject')) {
                vscode.commands.executeCommand('documentConverter.disableProject');
            } else if (choice === getMessage('openConfigFile') && configPath) {
                vscode.workspace.openTextDocument(configPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    });

    const installRuntimeCommand = vscode.commands.registerCommand('documentConverter.installRuntime', async () => {
        await converter.installManagedRuntime();
    });

    const repairRuntimeCommand = vscode.commands.registerCommand('documentConverter.repairRuntime', async () => {
        await converter.repairManagedRuntime();
    });

    const showRuntimeStatusCommand = vscode.commands.registerCommand('documentConverter.showRuntimeStatus', async () => {
        await converter.showManagedRuntimeStatus();
    });

    // Add disposables to context
    context.subscriptions.push(
        convertFileCommand,
        convertFolderCommand,
        enableProjectCommand,
        disableProjectCommand,
        showProjectStatusCommand,
        installRuntimeCommand,
        repairRuntimeCommand,
        showRuntimeStatusCommand,
        statusManager
    );

    // Update status
    statusManager.updateStatusBar(getStatusText('ready'));
    const watcherEnabled = !!projectManager?.isProjectEnabled() && getEffectiveAutoConvert();
    statusManager.showWatcherStatus(watcherEnabled, configManager.getSupportedExtensions());
}

export function deactivate() {
    if (fileWatcher) {
        fileWatcher.dispose();
    }
    if (statusManager) {
        statusManager.dispose();
    }
}
