import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectConfig {
    enabled: boolean;
    autoConvert: boolean;
    markdownSubdirectoryName: string;
    supportedExtensions: string[];
    lastActivated?: string;
}

export class ProjectManager {
    private static readonly CONFIG_FILE_NAME = '.docugenius.json';
    private static readonly DEFAULT_CONFIG: ProjectConfig = {
        enabled: false,
        autoConvert: true,
        markdownSubdirectoryName: 'DocuGenius',
        supportedExtensions: ['.docx', '.xlsx', '.pptx', '.pdf'],
        lastActivated: new Date().toISOString()
    };

    private shouldUseProjectConfig(): boolean {
        const config = vscode.workspace.getConfiguration('documentConverter');
        return config.get<boolean>('createProjectConfig', true);
    }

    private getConfiguredFolderName(): string {
        const config = vscode.workspace.getConfiguration('documentConverter');
        return config.get<string>('markdownSubdirectoryName', 'DocuGenius');
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
        const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);

        if (fs.existsSync(configPath)) {
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
            vscode.window.showErrorMessage('No workspace folder is open');
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
            // Only create project config file if user has enabled this option
            if (this.shouldUseProjectConfig()) {
                await this.saveProjectConfig(rootPath, projectConfig);
            }

            if (showConvertPrompt && this.hasConvertibleFiles(rootPath)) {
                const choice = await vscode.window.showInformationMessage(
                    `DocuGenius 已启用！检测到项目中有可转换的文档文件，是否立即转换？`,
                    '立即转换',
                    '稍后手动转换'
                );

                if (choice === '立即转换') {
                    // 触发文件夹转换命令
                    vscode.commands.executeCommand('documentConverter.convertFolder', vscode.Uri.file(rootPath));
                }
            } else if (!showConvertPrompt) {
                // 当 showConvertPrompt 为 false 时，不显示任何消息，由调用方处理
                // 这避免了重复的消息提示
            } else {
                vscode.window.showInformationMessage(
                    `✅ DocuGenius 已在当前项目启用！您可以右键文件进行转换，或在设置中开启自动转换。`
                );
            }
            
            return true;
        } catch (error) {
            console.error('Error enabling project:', error);
            vscode.window.showErrorMessage('Failed to enable DocuGenius for this project');
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
            if (this.shouldUseProjectConfig()) {
                const config = this.loadProjectConfig(rootPath);
                config.enabled = false;
                await this.saveProjectConfig(rootPath, config);
            }

            vscode.window.showInformationMessage('DocuGenius 已在当前项目禁用');
            return true;
        } catch (error) {
            console.error('Error disabling project:', error);
            vscode.window.showErrorMessage('Failed to disable DocuGenius for this project');
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

        if (!fs.existsSync(configPath)) {
            return { ...ProjectManager.DEFAULT_CONFIG };
        }

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
        const choice = await vscode.window.showInformationMessage(
            '是否要为此项目启用 DocuGenius ？',
            {
                modal: true,
                detail: '启用后，您可以手动转换文档或在设置中开启自动转换功能。\n\n转换后的文件将存储在 "DocuGenius" 文件夹中。'
            },
            '启用',
            '不启用',
            '稍后提醒'
        );

        switch (choice) {
            case '启用':
                // 用户已经在第一个弹窗中表达了启用意图，直接启用并自动转换，无需再次询问
                const enabled = await this.enableForProject(undefined, false);
                if (enabled) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && this.hasConvertibleFiles(workspaceFolders[0].uri.fsPath)) {
                        // 直接执行转换，不再询问
                        vscode.commands.executeCommand('documentConverter.convertFolder', workspaceFolders[0].uri);
                        vscode.window.showInformationMessage(
                            `已开始转换文档！将自动保存到 "DocuGenius" 文件夹中。`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `DocuGenius 已启用！可以右键文件进行转换，或在设置中开启自动转换。`
                        );
                    }
                }
                return enabled;
            case '不启用':
                // 只有在用户启用项目配置文件时才创建配置文件，避免重复提醒
                if (this.shouldUseProjectConfig()) {
                    await this.saveProjectConfig(
                        vscode.workspace.workspaceFolders![0].uri.fsPath,
                        { ...ProjectManager.DEFAULT_CONFIG, enabled: false }
                    );
                }
                return false;
            case '稍后提醒':
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
        const configPath = path.join(rootPath, ProjectManager.CONFIG_FILE_NAME);

        // If project config file exists, don't show prompt
        if (fs.existsSync(configPath)) {
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
