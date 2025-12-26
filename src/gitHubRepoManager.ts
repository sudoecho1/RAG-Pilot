import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import simpleGit from 'simple-git';

export interface RepoInfo {
    name: string;
    owner: string;
    url: string;
    path: string;
    indexedAt: Date;
}

export class GitHubRepoManager {
    private readonly reposPath: string;
    private readonly reposMetadataPath: string;
    private repos: Map<string, RepoInfo> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.reposPath = path.join(context.globalStorageUri.fsPath, 'repos');
        this.reposMetadataPath = path.join(context.globalStorageUri.fsPath, 'repos-metadata.json');
    }

    async initialize(): Promise<void> {
        // Create repos directory if it doesn't exist
        try {
            await fs.mkdir(this.reposPath, { recursive: true });
        } catch (error) {
            console.error('Failed to create repos directory:', error);
        }

        // Load existing repos metadata
        await this.loadReposMetadata();
    }

    async downloadRepo(repoUrl: string): Promise<RepoInfo> {
        // Parse GitHub URL
        const repoInfo = this.parseGitHubUrl(repoUrl);
        if (!repoInfo) {
            throw new Error('Invalid GitHub repository URL');
        }

        const repoKey = `${repoInfo.owner}/${repoInfo.name}`;
        const repoPath = path.join(this.reposPath, repoInfo.owner, repoInfo.name);

        // Check if repo already exists
        if (this.repos.has(repoKey)) {
            const existingRepo = this.repos.get(repoKey)!;
            const update = await vscode.window.showQuickPick(['Update', 'Cancel'], {
                placeHolder: `Repository ${repoKey} is already indexed. Update it?`
            });

            if (update === 'Update') {
                await this.updateRepo(existingRepo);
                return existingRepo;
            } else {
                throw new Error('Repository download cancelled');
            }
        }

        // Clone the repository
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${repoKey}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Cloning repository...' });

            // Ensure parent directory exists
            await fs.mkdir(path.dirname(repoPath), { recursive: true });

            const git = simpleGit();
            await git.clone(repoInfo.url, repoPath, ['--depth', '1']);

            progress.report({ message: 'Repository downloaded!' });
        });

        // Store repo metadata
        const repo: RepoInfo = {
            name: repoInfo.name,
            owner: repoInfo.owner,
            url: repoInfo.url,
            path: repoPath,
            indexedAt: new Date()
        };

        this.repos.set(repoKey, repo);
        await this.saveReposMetadata();

        return repo;
    }

    async updateRepo(repo: RepoInfo): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${repo.owner}/${repo.name}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Pulling latest changes...' });

            const git = simpleGit(repo.path);
            await git.pull();

            repo.indexedAt = new Date();
            await this.saveReposMetadata();

            progress.report({ message: 'Repository updated!' });
        });
    }

    async removeRepo(repoKey: string): Promise<void> {
        const repo = this.repos.get(repoKey);
        if (!repo) {
            throw new Error('Repository not found');
        }

        // Delete repository directory
        await fs.rm(repo.path, { recursive: true, force: true });

        // Remove from metadata
        this.repos.delete(repoKey);
        await this.saveReposMetadata();
    }

    getRepos(): RepoInfo[] {
        return Array.from(this.repos.values());
    }

    getRepoPath(repoKey: string): string | undefined {
        return this.repos.get(repoKey)?.path;
    }

    async getAllRepoFiles(repoKey: string): Promise<string[]> {
        const repo = this.repos.get(repoKey);
        if (!repo) {
            return [];
        }

        return await this.getFilesRecursive(repo.path);
    }

    private async getFilesRecursive(dir: string): Promise<string[]> {
        const files: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            // Skip .git directory
            if (entry.name === '.git') {
                continue;
            }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await this.getFilesRecursive(fullPath);
                files.push(...subFiles);
            } else if (this.isIndexableFile(entry.name)) {
                files.push(fullPath);
            }
        }

        return files;
    }

    private isIndexableFile(filename: string): boolean {
        const indexableExtensions = [
            '.ts', '.js', '.tsx', '.jsx',
            '.py', '.java', '.cpp', '.c', '.h', '.cs',
            '.go', '.rs', '.rb', '.php', '.swift',
            '.md', '.txt', '.json', '.yaml', '.yml'
        ];

        return indexableExtensions.some(ext => filename.endsWith(ext));
    }

    private parseGitHubUrl(url: string): { owner: string; name: string; url: string } | null {
        // Support various GitHub URL formats
        const patterns = [
            /github\.com\/([^\/]+)\/([^\/\.]+)/,
            /^([^\/]+)\/([^\/]+)$/ // owner/repo format
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                const owner = match[1];
                const name = match[2].replace(/\.git$/, '');
                return {
                    owner,
                    name,
                    url: `https://github.com/${owner}/${name}.git`
                };
            }
        }

        return null;
    }

    private async loadReposMetadata(): Promise<void> {
        try {
            const data = await fs.readFile(this.reposMetadataPath, 'utf-8');
            const reposArray: RepoInfo[] = JSON.parse(data);
            
            this.repos = new Map(
                reposArray.map(repo => [
                    `${repo.owner}/${repo.name}`,
                    { ...repo, indexedAt: new Date(repo.indexedAt) }
                ])
            );
        } catch (error) {
            // File doesn't exist or is invalid, start fresh
            this.repos = new Map();
        }
    }

    private async saveReposMetadata(): Promise<void> {
        const reposArray = Array.from(this.repos.values());
        await fs.writeFile(
            this.reposMetadataPath,
            JSON.stringify(reposArray, null, 2),
            'utf-8'
        );
    }
}
