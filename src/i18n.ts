import * as fs from 'fs';
import * as path from 'path';

interface LocalizedStrings {
    [key: string]: string;
}

export class I18nManager {
    private static instance: I18nManager;
    private localizedStrings: LocalizedStrings = {};
    private currentLocale: string = 'en';

    private constructor(private extensionPath: string) {
        this.loadLocalizedStrings();
    }

    public static getInstance(extensionPath?: string): I18nManager {
        if (!I18nManager.instance) {
            const resolvedExtensionPath = extensionPath || path.resolve(__dirname, '..');
            I18nManager.instance = new I18nManager(resolvedExtensionPath);
        }
        return I18nManager.instance;
    }

    private loadLocalizedStrings(): void {
        this.currentLocale = (this.getVscodeLanguage() || 'en').toLowerCase();

        try {
            const defaultStrings = this.readLocaleFile(path.join(this.extensionPath, 'package.nls.json'));
            this.localizedStrings = { ...defaultStrings };

            for (const locale of this.getLocaleCandidates(this.currentLocale)) {
                if (locale === 'en') {
                    continue;
                }

                const localeFile = path.join(this.extensionPath, `package.nls.${locale}.json`);
                if (!fs.existsSync(localeFile)) {
                    continue;
                }

                this.localizedStrings = {
                    ...this.localizedStrings,
                    ...this.readLocaleFile(localeFile)
                };
                break;
            }
        } catch (error) {
            console.error('Failed to load localized strings:', error);
            // Fallback to empty object, will use keys as values
            this.localizedStrings = {};
        }
    }

    private getLocaleCandidates(locale: string): string[] {
        const normalized = locale.toLowerCase();
        const candidates: string[] = [normalized];

        if (normalized.startsWith('zh')) {
            candidates.push('zh-cn', 'zh');
        } else {
            const languageOnly = normalized.split('-')[0];
            if (languageOnly !== normalized) {
                candidates.push(languageOnly);
            }
        }

        candidates.push('en');
        return [...new Set(candidates)];
    }

    private readLocaleFile(filePath: string): LocalizedStrings {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content) as LocalizedStrings;
    }

    private getVscodeLanguage(): string | undefined {
        try {
            const vscodeModule = require('vscode') as { env?: { language?: string } };
            return vscodeModule.env?.language;
        } catch {
            return undefined;
        }
    }

    public localize(key: string, ...args: any[]): string {
        let message = this.localizedStrings[key] || key;
        
        // Replace placeholders {0}, {1}, etc. with provided arguments
        if (args.length > 0) {
            message = message.replace(/\{(\d+)\}/g, (match, index) => {
                const argIndex = parseInt(index, 10);
                return argIndex < args.length ? String(args[argIndex]) : match;
            });
        }
        
        return message;
    }

    public getCurrentLocale(): string {
        return this.currentLocale;
    }

    // Convenience method for common messages
    public getMessage(key: string, ...args: any[]): string {
        return this.localize(`message.${key}`, ...args);
    }

    public getStatusText(key: string, ...args: any[]): string {
        return this.localize(`status.${key}`, ...args);
    }

    public getConfigDescription(key: string, ...args: any[]): string {
        return this.localize(`config.${key}`, ...args);
    }

    public getCommandTitle(key: string, ...args: any[]): string {
        return this.localize(`command.${key}`, ...args);
    }
}

// Convenience function for easy access
export function localize(key: string, ...args: any[]): string {
    return I18nManager.getInstance().localize(key, ...args);
}

export function getMessage(key: string, ...args: any[]): string {
    return I18nManager.getInstance().getMessage(key, ...args);
}

export function getStatusText(key: string, ...args: any[]): string {
    return I18nManager.getInstance().getStatusText(key, ...args);
}
