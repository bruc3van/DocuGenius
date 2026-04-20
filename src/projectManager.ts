import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { localize } from './i18n';

export interface ProjectConfig {
    enabled: boolean;
    autoConvert: boolean;
    markdownSubdirectoryName: string;
    supportedExtensions: string[];
    lastActivated?: string;
}

export class ProjectManager {
    private static readonly CONFIG_FILE_NAME = '.docugenius.json';
    private static readonly WORKSPACE_STATE_PREFIX = 'docugenius.projectConfig';
    private static readonly DEFAULT_CONFIG: ProjectConfig = {
        enabled: false,
        autoConvert: true,
        markdownSubdirectoryName: 'DocuGenius',
        supportedExtensions: ['.docx', '.xlsx', '.pptx', '.pdf'],
        lastActivated: new Date().toISOString()
    };

    constructor(private readonly context: vscode.ExtensionContext) {}

    private shouldUseProjectConfig(): boolean {
        const config = vscode.workspace.getConfiguration('documentConverter');
        return config.get<boolean>('createProjectConfig', true);
    }

    private getConfiguredFolderName(): string {
        const config = vscode.workspace.getConfiguration('documentConverter');
        return config.get<string>('markdownSubdirectoryName', 'DocuGenius');
    }

    private getWorkspaceConfigKey(rootPath: string): string {
        return `${ProjectManager.WORKSPACE_STATE_PREFIX}:${rootPath}`;
    }

    private loadWorkspaceProjectConfig(rootPath: string): ProjectConfig | undefined {
        return this.context.workspaceState.get<ProjectConfig>(this.getWorkspaceConfigKey(rootPath));
    }

    private async saveWorkspaceProjectConfig(rootPath: string, config: ProjectConfig): Promise<void> {
        await this.context.workspaceState.update(this.getWorkspaceConfigKey(rootPath), config);
    }

    private async clearWorkspaceProjectConfig(rootPath: string): Promise<void> {
        await this.context.workspaceState.update(this.getWorkspaceConfigKey(rootPath), undefined);
    }

    private hasPersistedProjectState(rootPath: string): boolean {
        const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);
        return fs.existsSync(configPath) || this.loadWorkspaceProjectConfig(rootPath) !== undefined;
    }

    /**
     * 检查当前工作区是否启用了 DocuGenius
     */
    isProjectEnabled(): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        if (this.hasPersistedProjectState(rootPath)) {
            try {
                const config = this.loadProjectConfig(rootPath);
                return config.enabled;
            } catch (error) {
                console.error('Error reading project config:', error);
                return false;
            }
        }

        // 如果没有配置文件，检查是否已存在输出目录（兼容历史项目）
        return this.hasExistingOutputFolder(rootPath);
    }

    /**
     * 获取项目级别的 autoConvert 设置（若项目未启用则返回 undefined）
     */
    getProjectAutoConvert(): boolean | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        const config = this.loadProjectConfig(workspaceFolders[0].uri.fsPath);
        if (config.enabled) {
            return config.autoConvert;
        }
        return undefined;
    }

    /**
     * 检查项目中是否已存在输出目录（说明之前使用过）
     */
    private hasExistingOutputFolder(rootPath: string): boolean {
        const configuredFolderName = this.getConfiguredFolderName();
        const candidateFolders = new Set<string>([
            configuredFolderName,
            ProjectManager.DEFAULT_CONFIG.markdownSubdirectoryName,
            'kb'
        ]);

        for (const folderName of candidateFolders) {
            const folderPath = path.join(rootPath, folderName);
            if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
                return true;
            }
        }

        return false;
    }

    /**
     * 检查项目中是否有可转换的文档文件
     */
    hasConvertibleFiles(rootPath?: string): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const targetPath = rootPath || workspaceFolders[0].uri.fsPath;
        const supportedExtensions = ['.docx', '.xlsx', '.pptx', '.pdf'];
        
        try {
            const files = fs.readdirSync(targetPath);
            return files.some(file => {
                const ext = path.extname(file).toLowerCase();
                return supportedExtensions.includes(ext);
            });
        } catch (error) {
            console.error('Error checking for convertible files:', error);
            return false;
        }
    }

    /**
     * 为当前项目启用 DocuGenius
     */
    async enableForProject(config?: Partial<ProjectConfig>, showConvertPrompt: boolean = false): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(localize('project.error.noWorkspaceFolder'));
            return false;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectConfig: ProjectConfig = {
            ...ProjectManager.DEFAULT_CONFIG,
            ...config,
            enabled: true,
            lastActivated: new Date().toISOString()
        };

        try {
            const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);
            const shouldPersistToFile = this.shouldUseProjectConfig() || fs.existsSync(configPath);

            if (shouldPersistToFile) {
                await this.saveProjectConfig(rootPath, projectConfig);
                await this.clearWorkspaceProjectConfig(rootPath);
            } else {
                await this.saveWorkspaceProjectConfig(rootPath, projectConfig);
            }

            if (showConvertPrompt && this.hasConvertibleFiles(rootPath)) {
                const convertNowLabel = localize('project.action.convertNow');
                const choice = await vscode.window.showInformationMessage(
                    localize('project.prompt.convertDetected'),
                    convertNowLabel,
                    localize('project.action.convertLater')
                );

                if (choice === convertNowLabel) {
                    // 触发文件夹转换命令
                    await vscode.commands.executeCommand('documentConverter.convertFolder', vscode.Uri.file(rootPath));
                }
            } else if (!showConvertPrompt) {
                // 当 showConvertPrompt 为 false 时，不显示任何消息，由调用方处理
                // 这避免了重复的消息提示
            } else {
                vscode.window.showInformationMessage(
                    localize('project.info.enabledReady')
                );
            }
            
            return true;
        } catch (error) {
            console.error('Error enabling project:', error);
            vscode.window.showErrorMessage(localize('project.error.enableFailed'));
            return false;
        }
    }

    /**
     * 为当前项目禁用 DocuGenius
     */
    async disableForProject(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        try {
            const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);
            const shouldPersistToFile = this.shouldUseProjectConfig() || fs.existsSync(configPath);

            if (shouldPersistToFile) {
                const config = this.loadProjectConfig(rootPath);
                config.enabled = false;
                await this.saveProjectConfig(rootPath, config);
                await this.clearWorkspaceProjectConfig(rootPath);
            } else {
                const config = this.loadProjectConfig(rootPath);
                config.enabled = false;
                config.lastActivated = new Date().toISOString();
                await this.saveWorkspaceProjectConfig(rootPath, config);
            }

            vscode.window.showInformationMessage(localize('project.info.disabled'));
            return true;
        } catch (error) {
            console.error('Error disabling project:', error);
            vscode.window.showErrorMessage(localize('project.error.disableFailed'));
            return false;
        }
    }

    /**
     * 加载项目配置
     */
    loadProjectConfig(rootPath?: string): ProjectConfig {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return { ...ProjectManager.DEFAULT_CONFIG };
        }

        const targetPath = rootPath || workspaceFolders[0].uri.fsPath;
        const configPath = path.join(targetPath, ProjectManager.CONFIG_FILE_NAME);

        if (fs.existsSync(configPath)) {
            try {
                const configContent = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configContent) as ProjectConfig;

                // 合并默认配置以确保所有字段都存在
                return { ...ProjectManager.DEFAULT_CONFIG, ...config };
            } catch (error) {
                console.error('Error parsing project config:', error);
                return { ...ProjectManager.DEFAULT_CONFIG };
            }
        }

        const workspaceConfig = this.loadWorkspaceProjectConfig(targetPath);
        if (workspaceConfig) {
            return { ...ProjectManager.DEFAULT_CONFIG, ...workspaceConfig };
        }

        return { ...ProjectManager.DEFAULT_CONFIG };
    }

    /**
     * 保存项目配置
     */
    private async saveProjectConfig(rootPath: string, config: ProjectConfig): Promise<void> {
        const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);
        const configContent = JSON.stringify(config, null, 2);
        
        fs.writeFileSync(configPath, configContent, 'utf8');
    }

    /**
     * 显示项目启用确认对话框
     */
    async showEnableDialog(): Promise<boolean> {
        const enableLabel = localize('project.action.enable');
        const dontAskAgainLabel = localize('project.action.notEnable');
        const remindLaterLabel = localize('project.action.remindLater');

        const choice = await vscode.window.showInformationMessage(
            localize('project.prompt.enableTitle'),
            {
                modal: true,
                detail: localize('project.prompt.enableDetail')
            },
            enableLabel,
            dontAskAgainLabel,
            remindLaterLabel
        );

        switch (choice) {
            case enableLabel:
                // 用户已经在第一个弹窗中表达了启用意图，直接启用并自动转换，无需再次询问
                const enabled = await this.enableForProject(undefined, false);
                if (enabled) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && this.hasConvertibleFiles(workspaceFolders[0].uri.fsPath)) {
                        // 直接执行转换，不再询问
                        await vscode.commands.executeCommand('documentConverter.convertFolder', workspaceFolders[0].uri);
                        vscode.window.showInformationMessage(
                            localize('project.info.conversionStarted')
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            localize('project.info.enabledReady')
                        );
                    }
                }
                return enabled;
            case dontAskAgainLabel:
                await this.saveWorkspaceProjectConfig(
                    vscode.workspace.workspaceFolders![0].uri.fsPath,
                    { ...ProjectManager.DEFAULT_CONFIG, enabled: false, lastActivated: new Date().toISOString() }
                );
                return false;
            case remindLaterLabel:
            default:
                return false;
        }
    }

    /**
     * 获取项目配置文件路径
     */
    getConfigFilePath(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        return path.join(workspaceFolders[0].uri.fsPath, ProjectManager.CONFIG_FILE_NAME);
    }

    /**
     * 检查是否应该显示启用提示
     */
    shouldShowEnablePrompt(): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        // Respect any explicit project decision persisted either in .docugenius.json
        // or in VS Code workspace storage, including "don't ask again".
        if (this.hasPersistedProjectState(rootPath)) {
            return false;
        }

        // 已有输出目录（说明之前使用过），不提示
        if (this.hasExistingOutputFolder(rootPath)) {
            return false;
        }

        // 如果有可转换文件，显示提示
        return this.hasConvertibleFiles(rootPath);
    }
}
