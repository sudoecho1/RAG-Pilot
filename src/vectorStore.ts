import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LocalIndex, LocalDocument } from 'vectra';

interface DocumentMetadata {
    file: string;
    line?: number;
    source?: 'workspace' | 'github';
    repo?: string;
    text?: string;
}

export class VectorStore {
    private index: LocalIndex | null = null;
    private embedder: any = null;
    private readonly indexPath: string;
    private indexedFolders: Set<string> = new Set();
    private readonly indexedFoldersPath: string;

    constructor(private context: vscode.ExtensionContext) {
        this.indexPath = path.join(context.globalStorageUri.fsPath, '.rag-index');
        this.indexedFoldersPath = path.join(context.globalStorageUri.fsPath, 'indexed-folders.json');
    }

    async initialize(): Promise<void> {
        try {
            // Dynamically import the pipeline function
            const { pipeline } = await import('@xenova/transformers');
            
            // Get embedding model from configuration
            const config = vscode.workspace.getConfiguration('ragPilot');
            const modelName = config.get<string>('embeddingModel') || 'Xenova/bge-base-en-v1.5';
            
            console.log(`Initializing embedding model: ${modelName}`);
            
            // Initialize the embedding model
            this.embedder = await pipeline('feature-extraction', modelName);
            
            // Initialize or load existing index
            this.index = new LocalIndex(this.indexPath);
            
            if (await this.index.isIndexCreated()) {
                await this.index.beginUpdate();
                await this.index.endUpdate();
            } else {
                await this.index.createIndex();
            }

            // Load indexed folders
            await this.loadIndexedFolders();
        } catch (error) {
            console.error('Failed to initialize vector store:', error);
            vscode.window.showErrorMessage('Failed to initialize RAG vector store');
        }
    }

    async hasIndex(): Promise<boolean> {
        return this.index !== null && await this.index.isIndexCreated();
    }

    async indexWorkspace(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken,
        specificFolder?: vscode.Uri
    ): Promise<void> {
        if (!this.index || !this.embedder) {
            throw new Error('Vector store not initialized');
        }

        await this.index.beginUpdate();

        // Get patterns from configuration
        const config = vscode.workspace.getConfiguration('ragPilot');
        const includePatterns = config.get<string[]>('includePatterns') || ['**/*.{ts,js,py,java,cpp,c,h,cs,go,rs,md,txt,json}'];
        const excludePatterns = config.get<string[]>('excludePatterns') || ['**/node_modules/**'];

        // Build glob pattern
        const includePattern = includePatterns.length === 1 ? includePatterns[0] : `{${includePatterns.join(',')}}`;
        const excludePattern = excludePatterns.length === 1 ? excludePatterns[0] : `{${excludePatterns.join(',')}}`;

        // Find files in the specific folder or entire workspace
        const searchPattern = specificFolder 
            ? new vscode.RelativePattern(specificFolder, includePattern)
            : includePattern;

        const files = await vscode.workspace.findFiles(
            searchPattern,
            excludePattern
        );

        const totalFiles = files.length;
        let processedFiles = 0;

        for (const file of files) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();

                // Split document into chunks (simple approach: by lines)
                const chunks = this.chunkDocument(text, 100, 20);
                
                for (const chunk of chunks) {
                    const embedding = await this.createEmbedding(chunk.text);
                    
                    await this.index.insertItem({
                        vector: embedding,
                        metadata: {
                            file: vscode.workspace.asRelativePath(file),
                            line: chunk.startLine,
                            source: 'workspace',
                            text: chunk.text
                        } as any
                    });
                }

                processedFiles++;
                const fileName = specificFolder 
                    ? path.relative(specificFolder.fsPath, file.fsPath)
                    : vscode.workspace.asRelativePath(file);
                progress.report({
                    message: `Indexing ${fileName}`,
                    increment: (100 / totalFiles)
                });

            } catch (error) {
                console.error(`Failed to index file ${file.fsPath}:`, error);
            }
        }

        await this.index.endUpdate();

        // Track indexed folder
        const folderPath = specificFolder 
            ? vscode.workspace.asRelativePath(specificFolder)
            : 'Entire Workspace';
        this.indexedFolders.add(folderPath);
        await this.saveIndexedFolders();
    }

    async indexFiles(
        files: vscode.Uri[],
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!this.index || !this.embedder) {
            throw new Error('Vector store not initialized');
        }

        await this.index.beginUpdate();

        const totalFiles = files.length;
        let processedFiles = 0;

        for (const file of files) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();

                const chunks = this.chunkDocument(text, 100, 20);
                
                for (const chunk of chunks) {
                    const embedding = await this.createEmbedding(chunk.text);
                    
                    await this.index.insertItem({
                        vector: embedding,
                        metadata: {
                            file: vscode.workspace.asRelativePath(file),
                            line: chunk.startLine,
                            source: 'workspace',
                            text: chunk.text
                        } as any
                    });
                }

                processedFiles++;
                const fileName = vscode.workspace.asRelativePath(file);
                progress.report({
                    message: `Indexing ${fileName}`,
                    increment: (100 / totalFiles)
                });

                this.indexedFolders.add(fileName);

            } catch (error) {
                console.error(`Failed to index file ${file.fsPath}:`, error);
            }
        }

        await this.index.endUpdate();
        await this.saveIndexedFolders();
    }

    async indexGitHubRepo(
        repoKey: string,
        repoPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!this.index || !this.embedder) {
            throw new Error('Vector store not initialized');
        }

        await this.index.beginUpdate();

        const files = await this.getFilesInDirectory(repoPath);
        const totalFiles = files.length;
        let processedFiles = 0;

        for (const filePath of files) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const text = await fs.readFile(filePath, 'utf-8');
                const relativePath = path.relative(repoPath, filePath);

                // Split document into chunks
                const chunks = this.chunkDocument(text, 100, 20);
                
                for (const chunk of chunks) {
                    const embedding = await this.createEmbedding(chunk.text);
                    
                    await this.index.insertItem({
                        vector: embedding,
                        metadata: {
                            file: relativePath,
                            line: chunk.startLine,
                            source: 'github',
                            repo: repoKey,
                            text: chunk.text
                        } as any
                    });
                }

                processedFiles++;
                progress.report({
                    message: `Indexing ${relativePath}`,
                    increment: (100 / totalFiles)
                });

            } catch (error) {
                console.error(`Failed to index file ${filePath}:`, error);
            }
        }

        await this.index.endUpdate();
    }

    async removeRepoFromIndex(repoKey: string): Promise<void> {
        if (!this.index) {
            return;
        }

        await this.index.beginUpdate();
        
        // Get all items and filter out the repo's items
        const allItems = await this.index.listItems();
        const itemsToKeep = allItems.filter(item => {
            const metadata = item.metadata as any;
            return metadata.source !== 'github' || metadata.repo !== repoKey;
        });
        
        // Rebuild index
        await this.index.deleteIndex();
        await this.index.createIndex();

        // Add back items (without IDs to avoid conflicts)
        for (const item of itemsToKeep) {
            await this.index.insertItem({
                vector: item.vector,
                metadata: item.metadata
            });
        }

        await this.index.endUpdate();
    }

    async removeFolderFromIndex(folderPath: string): Promise<void> {
        if (!this.index) {
            return;
        }

        await this.index.beginUpdate();
        
        // Get all items and filter out items from this folder
        const allItems = await this.index.listItems();
        const itemsToKeep = allItems.filter(item => {
            const metadata = item.metadata as any;
            // Keep items that don't have a file path or don't start with the folder path
            return !metadata.file || !metadata.file.startsWith(folderPath);
        });
        
        // Rebuild index
        await this.index.deleteIndex();
        await this.index.createIndex();

        // Add back items (without IDs to avoid conflicts)
        for (const item of itemsToKeep) {
            await this.index.insertItem({
                vector: item.vector,
                metadata: item.metadata
            });
        }

        await this.index.endUpdate();
        
        // Remove from indexed folders set
        this.indexedFolders.delete(folderPath);
        await this.saveIndexedFolders();
    }

    private async getFilesInDirectory(dir: string): Promise<string[]> {
        const files: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules') {
                continue;
            }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await this.getFilesInDirectory(fullPath);
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

    async search(query: string, topK: number = 5): Promise<Array<{ text: string; metadata: DocumentMetadata; score: number }>> {
        if (!this.index || !this.embedder) {
            return [];
        }

        const queryEmbedding = await this.createEmbedding(query);
        const results = await this.index.queryItems(queryEmbedding, topK);

        return results.map(result => {
            const metadata = result.item.metadata as any;
            return {
                text: metadata.text || '',
                metadata: metadata as DocumentMetadata,
                score: result.score
            };
        });
    }

    async clearIndex(): Promise<void> {
        if (!this.index) {
            return;
        }

        await this.index.beginUpdate();
        await this.index.deleteIndex();
        await this.index.createIndex();
        await this.index.endUpdate();

        // Clear indexed folders tracking
        this.indexedFolders.clear();
        await this.saveIndexedFolders();
    }

    getIndexedFolders(): string[] {
        return Array.from(this.indexedFolders);
    }

    private async loadIndexedFolders(): Promise<void> {
        try {
            const data = await fs.readFile(this.indexedFoldersPath, 'utf-8');
            const folders: string[] = JSON.parse(data);
            this.indexedFolders = new Set(folders);
        } catch (error) {
            // File doesn't exist or is invalid, start fresh
            this.indexedFolders = new Set();
        }
    }

    private async saveIndexedFolders(): Promise<void> {
        try {
            // Ensure parent directory exists
            const parentDir = path.dirname(this.indexedFoldersPath);
            await fs.mkdir(parentDir, { recursive: true });
            
            const folders = Array.from(this.indexedFolders);
            await fs.writeFile(
                this.indexedFoldersPath,
                JSON.stringify(folders, null, 2),
                'utf-8'
            );
        } catch (error) {
            console.error('Failed to save indexed folders:', error);
        }
    }

    private async createEmbedding(text: string): Promise<number[]> {
        if (!this.embedder) {
            throw new Error('Embedder not initialized');
        }

        const output = await this.embedder(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
    }

    private chunkDocument(text: string, chunkSize: number, overlap: number): Array<{ text: string; startLine: number }> {
        const lines = text.split('\n');
        const chunks: Array<{ text: string; startLine: number }> = [];

        for (let i = 0; i < lines.length; i += chunkSize - overlap) {
            const chunk = lines.slice(i, i + chunkSize).join('\n');
            if (chunk.trim().length > 0) {
                chunks.push({
                    text: chunk,
                    startLine: i + 1
                });
            }
        }

        return chunks;
    }
}
