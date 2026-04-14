import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { StatusManager } from './statusManager';
import { localize } from './i18n';

export type ConversionTrigger = 'manual' | 'auto' | 'batch';

interface CommandResult {
    stdout: string;
    stderr: string;
}

interface PythonCandidate {
    command: string;
    args: string[];
    executablePath: string;
    version: string;
    major: number;
    minor: number;
    description: string;
}

interface RuntimeMetadata {
    runtimeVersion: string;
    bootstrapCommand: string;
    bootstrapExecutable: string;
    createdAt: string;
    updatedAt: string;
}

interface RuntimeInspection {
    status: 'ready' | 'needs-install' | 'missing-python';
    runtimeDir: string;
    runtimePythonPath: string;
    runtimeVersion: string;
    detail: string;
    bootstrapCandidate?: PythonCandidate;
}

export interface RuntimeResolution {
    ready: boolean;
    pythonPath?: string;
    error?: string;
}

export class RuntimeManager {
    private static readonly RUNTIME_VERSION = '1';
    private static readonly MIN_PYTHON_MAJOR = 3;
    private static readonly MIN_PYTHON_MINOR = 6;
    private static readonly PROMPT_COOLDOWN_MS = 60_000;
    private static readonly REQUIRED_PACKAGES = [
        'python-docx',
        'openpyxl',
        'python-pptx',
        'pdfplumber'
    ];

    private installPromise?: Promise<RuntimeResolution>;
    private cachedPythonPath?: string;
    private promptDeferredUntil = 0;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly statusManager: StatusManager
    ) {}

    isManagedRuntimePlatform(): boolean {
        return process.platform === 'win32';
    }

    async ensureReadyForConversion(trigger: ConversionTrigger): Promise<RuntimeResolution> {
        if (!this.isManagedRuntimePlatform()) {
            this.statusManager.clearRuntimeActionRequired();
            return { ready: true };
        }

        if (this.cachedPythonPath && fs.existsSync(this.cachedPythonPath)) {
            return { ready: true, pythonPath: this.cachedPythonPath };
        }

        const inspection = await this.inspectRuntime();
        if (inspection.status === 'ready') {
            this.cachedPythonPath = inspection.runtimePythonPath;
            this.statusManager.clearRuntimeActionRequired();
            return { ready: true, pythonPath: inspection.runtimePythonPath };
        }

        if (inspection.status === 'missing-python') {
            this.statusManager.showRuntimeActionRequired(inspection.detail, true);
            return this.handleMissingPython(trigger, inspection);
        }

        this.statusManager.showRuntimeActionRequired(inspection.detail);

        if (trigger !== 'manual' && Date.now() < this.promptDeferredUntil) {
            return {
                ready: false,
                error: localize('runtime.error.setupDeferred')
            };
        }

        const shouldInstall = await this.promptToPrepareRuntime(trigger, inspection);
        if (!shouldInstall) {
            this.promptDeferredUntil = Date.now() + RuntimeManager.PROMPT_COOLDOWN_MS;
            return {
                ready: false,
                error: localize('runtime.error.setupDeferred')
            };
        }

        return this.installOrRepairRuntime(false);
    }

    async refreshStatusIndicator(): Promise<void> {
        if (!this.isManagedRuntimePlatform()) {
            this.statusManager.clearRuntimeActionRequired();
            return;
        }

        const inspection = await this.inspectRuntime();
        if (inspection.status === 'ready') {
            this.cachedPythonPath = inspection.runtimePythonPath;
            this.statusManager.clearRuntimeActionRequired();
            return;
        }

        this.statusManager.showRuntimeActionRequired(
            inspection.detail,
            inspection.status === 'missing-python'
        );
    }

    async installOrRepairRuntime(forceReinstall: boolean): Promise<RuntimeResolution> {
        if (!this.isManagedRuntimePlatform()) {
            return { ready: true };
        }

        if (this.installPromise) {
            return this.installPromise;
        }

        this.installPromise = this.installManagedRuntime(forceReinstall);
        try {
            return await this.installPromise;
        } finally {
            this.installPromise = undefined;
        }
    }

    async showRuntimeStatus(): Promise<void> {
        if (!this.isManagedRuntimePlatform()) {
            await vscode.window.showInformationMessage(localize('runtime.status.notManagedPlatform'));
            return;
        }

        const inspection = await this.inspectRuntime();
        const actions: string[] = [];

        if (inspection.status === 'ready') {
            this.statusManager.clearRuntimeActionRequired();
            actions.push(localize('runtime.action.repair'), localize('runtime.action.openLogs'));
        } else if (inspection.status === 'missing-python') {
            this.statusManager.showRuntimeActionRequired(inspection.detail, true);
            actions.push(localize('runtime.action.openPythonDownload'), localize('runtime.action.openLogs'));
        } else {
            this.statusManager.showRuntimeActionRequired(inspection.detail);
            actions.push(localize('runtime.action.install'), localize('runtime.action.openLogs'));
        }

        const choice = await vscode.window.showInformationMessage(
            inspection.status === 'ready'
                ? localize('runtime.status.readyTitle')
                : localize('runtime.status.issueTitle'),
            {
                modal: true,
                detail: this.buildStatusDetail(inspection)
            },
            ...actions
        );

        if (choice === localize('runtime.action.install')) {
            await this.installOrRepairRuntime(false);
        } else if (choice === localize('runtime.action.repair')) {
            await this.installOrRepairRuntime(true);
        } else if (choice === localize('runtime.action.openPythonDownload')) {
            await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/windows/'));
        } else if (choice === localize('runtime.action.openLogs')) {
            await vscode.commands.executeCommand('documentConverter.showOutput');
        }
    }

    private async inspectRuntime(): Promise<RuntimeInspection> {
        const runtimeDir = this.getRuntimeDirectory();
        const runtimePythonPath = this.getRuntimePythonPath(runtimeDir);
        const metadata = this.readMetadata();

        if (
            metadata &&
            metadata.runtimeVersion === RuntimeManager.RUNTIME_VERSION &&
            fs.existsSync(runtimePythonPath) &&
            await this.verifyManagedRuntime(runtimePythonPath)
        ) {
            return {
                status: 'ready',
                runtimeDir,
                runtimePythonPath,
                runtimeVersion: metadata.runtimeVersion,
                detail: localize('runtime.detail.ready')
            };
        }

        const bootstrapCandidate = await this.findBootstrapPython();
        if (!bootstrapCandidate) {
            return {
                status: 'missing-python',
                runtimeDir,
                runtimePythonPath,
                runtimeVersion: metadata?.runtimeVersion || RuntimeManager.RUNTIME_VERSION,
                detail: localize('runtime.detail.missingPython')
            };
        }

        return {
            status: 'needs-install',
            runtimeDir,
            runtimePythonPath,
            runtimeVersion: metadata?.runtimeVersion || RuntimeManager.RUNTIME_VERSION,
            detail: metadata
                ? localize('runtime.detail.repairRequired')
                : localize('runtime.detail.installRequired'),
            bootstrapCandidate
        };
    }

    private async handleMissingPython(trigger: ConversionTrigger, inspection: RuntimeInspection): Promise<RuntimeResolution> {
        const buttons = [localize('runtime.action.openPythonDownload'), localize('runtime.action.openLogs')];
        const choice = trigger === 'manual'
            ? await vscode.window.showErrorMessage(
                localize('runtime.error.pythonMissing'),
                {
                    modal: true,
                    detail: this.buildStatusDetail(inspection)
                },
                ...buttons
            )
            : await vscode.window.showErrorMessage(localize('runtime.error.pythonMissing'), ...buttons);

        if (choice === localize('runtime.action.openPythonDownload')) {
            await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/windows/'));
        } else if (choice === localize('runtime.action.openLogs')) {
            await vscode.commands.executeCommand('documentConverter.showOutput');
        }

        return {
            ready: false,
            error: localize('runtime.error.pythonMissing')
        };
    }

    private async promptToPrepareRuntime(trigger: ConversionTrigger, inspection: RuntimeInspection): Promise<boolean> {
        const installLabel = localize('runtime.action.install');
        const viewDetailsLabel = localize('runtime.action.viewDetails');
        const cancelLabel = localize('runtime.action.notNow');

        const detail = this.buildStatusDetail(inspection);
        const choice = trigger === 'manual'
            ? await vscode.window.showInformationMessage(
                localize('runtime.prompt.manualTitle'),
                {
                    modal: true,
                    detail
                },
                installLabel,
                cancelLabel,
                viewDetailsLabel
            )
            : await vscode.window.showInformationMessage(
                localize('runtime.prompt.backgroundTitle'),
                installLabel,
                viewDetailsLabel,
                cancelLabel
            );

        if (choice === viewDetailsLabel) {
            await this.showRuntimeStatus();
            return false;
        }

        return choice === installLabel;
    }

    private async installManagedRuntime(forceReinstall: boolean): Promise<RuntimeResolution> {
        const inspection = await this.inspectRuntime();
        if (inspection.status === 'ready') {
            this.cachedPythonPath = inspection.runtimePythonPath;
            this.statusManager.clearRuntimeActionRequired();
            return {
                ready: true,
                pythonPath: inspection.runtimePythonPath
            };
        }

        if (!inspection.bootstrapCandidate) {
            this.statusManager.showRuntimeActionRequired(inspection.detail, true);
            return {
                ready: false,
                error: localize('runtime.error.pythonMissing')
            };
        }

        const runtimeDir = inspection.runtimeDir;
        const runtimePythonPath = inspection.runtimePythonPath;
        const candidate = inspection.bootstrapCandidate;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize(forceReinstall ? 'runtime.progress.repairTitle' : 'runtime.progress.installTitle'),
                    cancellable: false
                },
                async (progress) => {
                    this.statusManager.updateStatusBar(localize('status.runtimePreparing'));
                    this.statusManager.log(localize('log.runtime.bootstrap', candidate.description));

                    progress.report({ message: localize('runtime.progress.creatingEnvironment') });
                    await this.recreateRuntimeDirectory(runtimeDir, forceReinstall);
                    await this.runCommand(candidate.command, [...candidate.args, '-m', 'venv', runtimeDir], 120000);

                    progress.report({ message: localize('runtime.progress.installingDependencies') });
                    this.statusManager.log(localize('log.runtime.installPackages', RuntimeManager.REQUIRED_PACKAGES.join(', ')));
                    await this.runCommand(
                        runtimePythonPath,
                        [
                            '-m',
                            'pip',
                            'install',
                            '--disable-pip-version-check',
                            '--upgrade',
                            ...RuntimeManager.REQUIRED_PACKAGES
                        ],
                        300000
                    );

                    progress.report({ message: localize('runtime.progress.verifying') });
                    const verified = await this.verifyManagedRuntime(runtimePythonPath);
                    if (!verified) {
                        throw new Error(localize('runtime.error.verifyFailed'));
                    }

                    this.writeMetadata({
                        runtimeVersion: RuntimeManager.RUNTIME_VERSION,
                        bootstrapCommand: `${candidate.command} ${candidate.args.join(' ')}`.trim(),
                        bootstrapExecutable: candidate.executablePath,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            );

            this.cachedPythonPath = runtimePythonPath;
            this.statusManager.clearRuntimeActionRequired();
            this.statusManager.log(localize('log.runtime.ready', runtimePythonPath));

            await vscode.window.showInformationMessage(
                localize('runtime.success.ready'),
                localize('runtime.action.openLogs')
            ).then(async (choice) => {
                if (choice === localize('runtime.action.openLogs')) {
                    await vscode.commands.executeCommand('documentConverter.showOutput');
                }
            });

            return {
                ready: true,
                pythonPath: runtimePythonPath
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.cachedPythonPath = undefined;
            this.statusManager.log(localize('log.runtime.failed', message), true);
            this.statusManager.showRuntimeActionRequired(inspection.detail);

            await vscode.window.showErrorMessage(
                localize('runtime.error.installFailed'),
                localize('runtime.action.openLogs'),
                localize('runtime.action.openPythonDownload')
            ).then(async (choice) => {
                if (choice === localize('runtime.action.openLogs')) {
                    await vscode.commands.executeCommand('documentConverter.showOutput');
                } else if (choice === localize('runtime.action.openPythonDownload')) {
                    await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/windows/'));
                }
            });

            return {
                ready: false,
                error: localize('runtime.error.installFailed')
            };
        }
    }

    private async recreateRuntimeDirectory(runtimeDir: string, forceReinstall: boolean): Promise<void> {
        const globalStoragePath = path.resolve(this.context.globalStorageUri.fsPath);
        const resolvedRuntimeDir = path.resolve(runtimeDir);

        if (!resolvedRuntimeDir.startsWith(globalStoragePath)) {
            throw new Error(localize('runtime.error.invalidRuntimePath'));
        }

        fs.mkdirSync(globalStoragePath, { recursive: true });

        if (fs.existsSync(runtimeDir) && forceReinstall) {
            fs.rmSync(runtimeDir, { recursive: true, force: true });
        }
    }

    private async verifyManagedRuntime(runtimePythonPath: string): Promise<boolean> {
        try {
            await this.runCommand(
                runtimePythonPath,
                ['-c', 'import docx, openpyxl, pptx, pdfplumber; print("ok")'],
                20000
            );
            return true;
        } catch {
            return false;
        }
    }

    private async findBootstrapPython(): Promise<PythonCandidate | undefined> {
        const candidates = process.platform === 'win32'
            ? [
                { command: 'py', args: ['-3'], description: 'py -3' },
                { command: 'python', args: [], description: 'python' },
                { command: 'python3', args: [], description: 'python3' }
            ]
            : [
                { command: 'python3', args: [], description: 'python3' },
                { command: 'python', args: [], description: 'python' }
            ];

        for (const candidate of candidates) {
            try {
                const result = await this.runCommand(
                    candidate.command,
                    [
                        ...candidate.args,
                        '-c',
                        'import json, sys; print(json.dumps({"executable": sys.executable, "version": sys.version, "major": sys.version_info[0], "minor": sys.version_info[1]}))'
                    ],
                    15000
                );
                const parsed = JSON.parse(result.stdout.trim()) as {
                    executable: string;
                    version: string;
                    major: number;
                    minor: number;
                };

                if (
                    parsed.major > RuntimeManager.MIN_PYTHON_MAJOR ||
                    (
                        parsed.major === RuntimeManager.MIN_PYTHON_MAJOR &&
                        parsed.minor >= RuntimeManager.MIN_PYTHON_MINOR
                    )
                ) {
                    return {
                        command: candidate.command,
                        args: candidate.args,
                        executablePath: parsed.executable,
                        version: parsed.version,
                        major: parsed.major,
                        minor: parsed.minor,
                        description: `${candidate.description} (${parsed.executable})`
                    };
                }
            } catch {
                continue;
            }
        }

        return undefined;
    }

    private async runCommand(command: string, args: string[], timeout: number): Promise<CommandResult> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                shell: false
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                if (chunk.trim()) {
                    this.statusManager.log(chunk.trim());
                }
            });

            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(localize('runtime.error.timeout', timeout / 1000)));
            }, timeout);

            child.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new Error(stderr.trim() || stdout.trim() || `Command exited with code ${code}`));
                    return;
                }

                resolve({ stdout, stderr });
            });

            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    private getRuntimeDirectory(): string {
        return path.join(
            this.context.globalStorageUri.fsPath,
            'runtime',
            `${process.platform}-${process.arch}`
        );
    }

    private getRuntimePythonPath(runtimeDir: string): string {
        return process.platform === 'win32'
            ? path.join(runtimeDir, 'Scripts', 'python.exe')
            : path.join(runtimeDir, 'bin', 'python');
    }

    private getMetadataPath(): string {
        return path.join(this.getRuntimeDirectory(), 'runtime.json');
    }

    private readMetadata(): RuntimeMetadata | undefined {
        try {
            const metadataPath = this.getMetadataPath();
            if (!fs.existsSync(metadataPath)) {
                return undefined;
            }

            return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as RuntimeMetadata;
        } catch {
            return undefined;
        }
    }

    private writeMetadata(metadata: RuntimeMetadata): void {
        const metadataPath = this.getMetadataPath();
        fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    private buildStatusDetail(inspection: RuntimeInspection): string {
        const lines = [
            `${localize('runtime.status.locationLabel')}: ${inspection.runtimeDir}`,
            `${localize('runtime.status.versionLabel')}: ${inspection.runtimeVersion}`
        ];

        if (inspection.bootstrapCandidate) {
            lines.push(`${localize('runtime.status.bootstrapLabel')}: ${inspection.bootstrapCandidate.description}`);
        }

        lines.push(`${localize('runtime.status.detailLabel')}: ${inspection.detail}`);
        return lines.join('\n');
    }
}
