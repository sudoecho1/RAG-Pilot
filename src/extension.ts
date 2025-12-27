import * as vscode from 'vscode';
import * as path from 'path';
import { RagChatParticipant } from './ragChatParticipant.js';
import { VectorStore } from './vectorStore.js';
import { GitHubRepoManager } from './gitHubRepoManager.js';

let vectorStore: VectorStore;
let chatParticipant: RagChatParticipant;
let repoManager: GitHubRepoManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('=== RAG Pilot Extension Activating ===');
    console.log('Copilot RAG extension is now active');

    // Initialize GitHub repo manager
    repoManager = new GitHubRepoManager(context);
    await repoManager.initialize();
    console.log('GitHub repo manager initialized');

    // Initialize vector store
    vectorStore = new VectorStore(context);
    await vectorStore.initialize();
    console.log('Vector store initialized');

    // Register chat participant
    chatParticipant = new RagChatParticipant(vectorStore);
    const participant = vscode.chat.createChatParticipant('copilot-rag.assistant', chatParticipant.handleRequest.bind(chatParticipant));
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
    console.log('Chat participant registered with ID: copilot-rag.assistant, name: rag');
    
    // Discover and register custom prompts from .github/prompts/
    await discoverAndRegisterCustomPrompts(participant);
    
    context.subscriptions.push(participant);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.indexWorkspace', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing workspace for RAG',
                cancellable: true
            }, async (progress, token) => {
                await vectorStore.indexWorkspace(progress, token);
                vscode.window.showInformationMessage('Workspace indexed successfully!');
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.indexFolder', async (uri?: vscode.Uri) => {
            // If called from context menu, uri will be provided
            let folderUri = uri;

            // Otherwise, show folder picker
            if (!folderUri) {
                const selected = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Folder to Index',
                    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
                });

                if (!selected || selected.length === 0) {
                    return;
                }

                folderUri = selected[0];
            }

            const folderName = path.basename(folderUri.fsPath);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Indexing ${folderName}`,
                cancellable: true
            }, async (progress, token) => {
                await vectorStore.indexWorkspace(progress, token, folderUri);
                vscode.window.showInformationMessage(`Folder "${folderName}" indexed successfully!`);
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.indexFiles', async (uri?: vscode.Uri, allUris?: vscode.Uri[]) => {
            const filesToIndex = allUris && allUris.length > 0 ? allUris : (uri ? [uri] : []);

            if (filesToIndex.length === 0) {
                vscode.window.showWarningMessage('No files selected to index.');
                return;
            }

            const fileCount = filesToIndex.length;
            const fileWord = fileCount === 1 ? 'file' : 'files';

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Indexing ${fileCount} ${fileWord}`,
                cancellable: true
            }, async (progress, token) => {
                await vectorStore.indexFiles(filesToIndex, progress, token);
                vscode.window.showInformationMessage(`${fileCount} ${fileWord} indexed successfully!`);
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.addGitHubRepo', async () => {
            const repoUrl = await vscode.window.showInputBox({
                prompt: 'Enter GitHub repository URL or owner/repo',
                placeHolder: 'e.g., microsoft/vscode or https://github.com/microsoft/vscode',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Repository URL cannot be empty';
                    }
                    return null;
                }
            });

            if (!repoUrl) {
                return;
            }

            try {
                const repo = await repoManager.downloadRepo(repoUrl.trim());
                
                // Index the repository
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Indexing ${repo.owner}/${repo.name}`,
                    cancellable: true
                }, async (progress, token) => {
                    await vectorStore.indexGitHubRepo(
                        `${repo.owner}/${repo.name}`,
                        repo.path,
                        progress,
                        token
                    );
                });

                vscode.window.showInformationMessage(
                    `Repository ${repo.owner}/${repo.name} indexed successfully!`
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to add repository: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.listIndexedRepos', async () => {
            const repos = repoManager.getRepos();
            const folders = vectorStore.getIndexedFolders();
            
            if (repos.length === 0 && folders.length === 0) {
                vscode.window.showInformationMessage('No sources indexed yet.');
                return;
            }

            interface SourceQuickPickItem extends vscode.QuickPickItem {
                type?: 'folder' | 'repo' | 'header';
                key?: string;
            }

            const items: SourceQuickPickItem[] = [];

            // Add workspace folders
            if (folders.length > 0) {
                items.push({ label: '📁 Workspace Folders', type: 'header' });
                folders.forEach(folder => {
                    items.push({
                        label: `  ${folder}`,
                        description: 'Workspace',
                        type: 'folder',
                        key: folder
                    });
                });
            }

            // Add GitHub repos
            if (repos.length > 0) {
                if (items.length > 0) {
                    items.push({ label: '', type: 'header' }); // Spacer
                }
                items.push({ label: '📦 GitHub Repositories', type: 'header' });
                repos.forEach(repo => {
                    items.push({
                        label: `  ${repo.owner}/${repo.name}`,
                        description: `Indexed: ${repo.indexedAt.toLocaleDateString()}`,
                        detail: repo.url,
                        type: 'repo',
                        key: `${repo.owner}/${repo.name}`
                    });
                });
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Indexed Sources (select one to view actions)',
                canPickMany: false
            });

            if (!selected || selected.type === 'header') {
                return;
            }

            // Show actions for the selected source
            const action = await vscode.window.showQuickPick([
                { label: '🗑️  Remove from index', value: 'remove' },
                { label: '↩️  Cancel', value: 'cancel' }
            ], {
                placeHolder: `Actions for ${selected.label.trim()}`
            });

            if (action?.value === 'remove') {
                const confirm = await vscode.window.showWarningMessage(
                    `Remove ${selected.label.trim()} from index?`,
                    'Remove',
                    'Cancel'
                );

                if (confirm === 'Remove') {
                    try {
                        if (selected.type === 'repo') {
                            await vectorStore.removeRepoFromIndex(selected.key!);
                            await repoManager.removeRepo(selected.key!);
                        } else {
                            await vectorStore.removeFolderFromIndex(selected.key!);
                        }
                        vscode.window.showInformationMessage('Source removed successfully!');
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to remove source: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.removeRepo', async () => {
            const repos = repoManager.getRepos();
            
            if (repos.length === 0) {
                vscode.window.showInformationMessage('No repositories to remove.');
                return;
            }

            const items = repos.map(repo => ({
                label: `${repo.owner}/${repo.name}`,
                description: repo.url,
                repoKey: `${repo.owner}/${repo.name}`
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select repository to remove',
                canPickMany: false
            });

            if (!selected) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Remove ${selected.label} from index?`,
                'Remove',
                'Cancel'
            );

            if (confirm === 'Remove') {
                try {
                    await vectorStore.removeRepoFromIndex(selected.repoKey);
                    await repoManager.removeRepo(selected.repoKey);
                    vscode.window.showInformationMessage(
                        `Repository ${selected.label} removed successfully!`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to remove repository: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.removeSource', async () => {
            const repos = repoManager.getRepos();
            const folders = vectorStore.getIndexedFolders();
            
            if (repos.length === 0 && folders.length === 0) {
                vscode.window.showInformationMessage('No sources to remove.');
                return;
            }

            interface SourceItem {
                label: string;
                description: string;
                type: 'repo' | 'folder';
                key: string;
            }

            const items: SourceItem[] = [];

            // Add workspace folders
            folders.forEach(folder => {
                items.push({
                    label: `📁 ${folder}`,
                    description: 'Workspace folder',
                    type: 'folder',
                    key: folder
                });
            });

            // Add GitHub repos
            repos.forEach(repo => {
                items.push({
                    label: `📦 ${repo.owner}/${repo.name}`,
                    description: 'GitHub repository',
                    type: 'repo',
                    key: `${repo.owner}/${repo.name}`
                });
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select source to remove from index',
                canPickMany: false
            });

            if (!selected) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Remove ${selected.label} from index?`,
                'Remove',
                'Cancel'
            );

            if (confirm === 'Remove') {
                try {
                    if (selected.type === 'repo') {
                        await vectorStore.removeRepoFromIndex(selected.key);
                        await repoManager.removeRepo(selected.key);
                    } else {
                        await vectorStore.removeFolderFromIndex(selected.key);
                    }
                    vscode.window.showInformationMessage(
                        `Source removed successfully!`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to remove source: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.clearIndex', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear all indexed data including GitHub repositories?',
                'Clear All',
                'Cancel'
            );

            if (confirm === 'Clear All') {
                await vectorStore.clearIndex();
                await repoManager.clearAll();
                vscode.window.showInformationMessage('Vector index and all repositories cleared!');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-rag.openChat', async () => {
            // Open chat view and pre-fill with @rag
            await vscode.commands.executeCommand('workbench.action.chat.open', '@rag ');
        })
    );
}

export function deactivate() {}

async function discoverAndRegisterCustomPrompts(participant: vscode.ChatParticipant): Promise<void> {
    try {
        // Find all .prompt.md files in .github/prompts/
        const promptFiles = await vscode.workspace.findFiles('.github/prompts/*.prompt.md');
        
        console.log(`Found ${promptFiles.length} custom prompt files available for @rag slash commands`);
        
        for (const file of promptFiles) {
            const commandName = path.basename(file.fsPath, '.prompt.md');
            console.log(`Custom prompt available: /${commandName}`);
        }
    } catch (error) {
        console.log('Error discovering custom prompts:', error);
    }
}
