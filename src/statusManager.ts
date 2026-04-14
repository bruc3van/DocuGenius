import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration';
import { localize } from './i18n';

export class StatusManager {
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    private configManager: ConfigurationManager;
    private statusBarResetTimer?: NodeJS.Timeout;
    private showOutputCommand: vscode.Disposable;
    private persistentStatusText = '';
    private persistentTooltip = '';
    private persistentCommand: string | undefined = 'documentConverter.showOutput';

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'documentConverter.showOutput';
        
        // Create output channel
        this.outputChannel = vscode.window.createOutputChannel('DocuGenius');
        
        // Register command to show output
        this.showOutputCommand = vscode.commands.registerCommand('documentConverter.showOutput', () => {
            this.outputChannel.show();
        });
        
        this.setPersistentStatus(
            `$(markdown) ${localize('status.ready')}`,
            localize('tooltip.ready', localize('status.ready')),
            'documentConverter.showOutput'
        );
        this.applyPersistentStatus();
    }

    /**
     * Update status bar with current status
     */
    updateStatusBar(status: string, tooltip?: string): void {
        this.renderStatusBar(`$(markdown) ${status}`, tooltip || localize('tooltip.ready', status), this.persistentCommand);
    }

    /**
     * Show conversion in progress
     */
    showConversionInProgress(fileName: string): void {
        const name = this.getFileName(fileName);
        this.updateStatusBar(
            localize('status.converting', name),
            localize('tooltip.converting', name)
        );
        this.log(localize('log.conversionStart', fileName));
    }

    /**
     * Show conversion success
     */
    showConversionSuccess(inputFile: string, outputFile: string, suppressNotification: boolean = false): void {
        const inputName = this.getFileName(inputFile);
        const outputName = this.getFileName(outputFile);
        const outputDir = this.getDirectoryName(outputFile);

        this.updateStatusBar(localize('status.ready'));
        this.log(localize('log.conversionSuccess', inputName, outputDir, outputName));

        // Show temporary success message in status bar
        this.updateStatusBar(
            localize('status.converted', inputName),
            localize('tooltip.converted', inputName)
        );

        // Show notification with action buttons (if enabled and not suppressed)
        if (this.configManager.shouldShowSuccessNotifications() && !suppressNotification) {
            vscode.window.showInformationMessage(
                localize('notification.conversionSuccess', inputName),
                localize('notification.openFile'),
                localize('notification.openFolder')
            ).then(selection => {
                if (selection === localize('notification.openFile')) {
                    // Open the converted file
                    vscode.workspace.openTextDocument(outputFile).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                } else if (selection === localize('notification.openFolder')) {
                    // Reveal the file in explorer
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputFile));
                }
            });
        }

        // Reset status bar after 5 seconds (increased from 3 seconds)
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 5000);
    }

    /**
     * Show conversion error
     */
    showConversionError(fileName: string, error: string): void {
        const name = this.getFileName(fileName);

        this.updateStatusBar(localize('status.ready'));
        this.log(localize('log.conversionError', name, error), true);

        // Show temporary error message in status bar
        this.updateStatusBar(
            localize('status.failed', name),
            localize('tooltip.failed', name, error)
        );

        // Reset status bar after 5 seconds
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 5000);
    }

    /**
     * Show batch conversion progress
     */
    showBatchProgress(current: number, total: number, currentFile?: string): void {
        const progress = `${current}/${total}`;
        const status = currentFile
            ? localize('status.batchProgressWithFile', current, total, this.getFileName(currentFile))
            : localize('status.batchProgress', current, total);

        this.updateStatusBar(status, localize('tooltip.batchProgress', progress));

        if (currentFile) {
            this.log(localize('log.batchProgress', progress, this.getFileName(currentFile)));
        }
    }

    /**
     * Show batch conversion complete
     */
    showBatchComplete(successCount: number, totalCount: number): void {
        const failureCount = totalCount - successCount;

        if (failureCount === 0) {
            this.log(localize('log.batchComplete', successCount));
            this.updateStatusBar(
                localize('status.batchComplete', successCount),
                localize('tooltip.batchComplete', successCount)
            );
        } else {
            this.log(localize('log.batchPartial', successCount, failureCount));
            this.updateStatusBar(
                localize('status.batchPartial', successCount, totalCount),
                localize('tooltip.batchPartial', successCount, failureCount)
            );
        }

        // Reset status bar after 5 seconds
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 5000);
    }

    /**
     * Show configuration change
     */
    showConfigurationChange(setting: string, value: any): void {
        this.log(localize('log.configChange', setting, value));
        this.updateStatusBar(
            localize('status.configUpdated'),
            localize('tooltip.configUpdated', setting)
        );

        // Reset status bar after 2 seconds
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 2000);
    }

    /**
     * Show file watcher status
     */
    showWatcherStatus(enabled: boolean, extensions: string[]): void {
        if (enabled) {
            this.log(localize('log.watcherEnabled', extensions.join(', ')));
            this.updateStatusBar(
                localize('status.watching'),
                localize('tooltip.watching', extensions.join(', '))
            );
        } else {
            this.log(localize('log.watcherDisabled'));
            this.updateStatusBar(
                localize('status.notWatching'),
                localize('tooltip.notWatching')
            );
        }

        // Reset status bar after 3 seconds
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 3000);
    }

    /**
     * Show file skipped message
     */
    showFileSkipped(fileName: string, reason: string): void {
        const name = this.getFileName(fileName);
        this.log(localize('log.fileSkipped', fileName, reason));

        // Show temporary skip message in status bar
        this.updateStatusBar(
            localize('status.skipped', name),
            localize('tooltip.skipped', name, reason)
        );

        // Reset status bar after 2 seconds
        this.clearStatusBarResetTimer();
        this.statusBarResetTimer = setTimeout(() => {
            this.applyPersistentStatus();
        }, 2000);
    }

    showRuntimeActionRequired(detail: string, requiresPythonInstall: boolean = false): void {
        const status = requiresPythonInstall
            ? localize('status.runtimePythonMissing')
            : localize('status.runtimeActionRequired');
        const tooltip = requiresPythonInstall
            ? localize('tooltip.runtimePythonMissing', detail)
            : localize('tooltip.runtimeActionRequired', detail);

        this.setPersistentStatus(
            `$(warning) ${status}`,
            tooltip,
            'documentConverter.showRuntimeStatus'
        );
        this.applyPersistentStatus();
    }

    clearRuntimeActionRequired(): void {
        this.setPersistentStatus(
            `$(markdown) ${localize('status.ready')}`,
            localize('tooltip.ready', localize('status.ready')),
            'documentConverter.showOutput'
        );
        this.applyPersistentStatus();
    }

    /**
     * Log message to output channel
     */
    log(message: string, isError: boolean = false): void {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = isError ? '[ERROR]' : '[INFO]';
        this.outputChannel.appendLine(`${timestamp} ${prefix} ${message}`);
    }

    private setPersistentStatus(text: string, tooltip: string, command?: string): void {
        this.persistentStatusText = text;
        this.persistentTooltip = tooltip;
        this.persistentCommand = command;
    }

    private applyPersistentStatus(): void {
        this.renderStatusBar(this.persistentStatusText, this.persistentTooltip, this.persistentCommand);
    }

    private renderStatusBar(text: string, tooltip: string, command?: string): void {
        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.command = command;
        this.statusBarItem.show();
    }

    /**
     * Get file name from path
     */
    private getFileName(filePath: string): string {
        return filePath.split(/[/\\]/).pop() || filePath;
    }

    /**
     * Get directory name from path
     */
    private getDirectoryName(filePath: string): string {
        const parts = filePath.split(/[/\\]/);
        return parts[parts.length - 2] || '';
    }

    /**
     * Clear pending status bar reset timer
     */
    private clearStatusBarResetTimer(): void {
        if (this.statusBarResetTimer) {
            clearTimeout(this.statusBarResetTimer);
            this.statusBarResetTimer = undefined;
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.clearStatusBarResetTimer();
        this.showOutputCommand.dispose();
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}
