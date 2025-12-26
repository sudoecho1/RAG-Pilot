import * as vscode from 'vscode';
import * as path from 'path';
import { RagChatParticipant } from './ragChatParticipant.js';
import { VectorStore } from './vectorStore.js';
import { GitHubRepoManager } from './gitHubRepoManager.js';

let vectorStore: VectorStore;
let chatParticipant: RagChatParticipant;
let repoManager: GitHubRepoManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Copilot RAG extension is now active');

    // Initialize GitHub repo manager
    repoManager = new GitHubRepoManager(context);
    await repoManager.initialize();

    // Initialize vector store
    vectorStore = new VectorStore(context);
    await vectorStore.initialize();

    // Register chat participant
    chatParticipant = new RagChatParticipant(vectorStore);
    const participant = vscode.chat.createChatParticipant('copilot-rag.assistant', chatParticipant.handleRequest.bind(chatParticipant));
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
    
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

            const items: Array<{ label: string; description?: string; detail?: string }> = [];

            // Add workspace folders
            if (folders.length > 0) {
                items.push({ label: '📁 Workspace Folders', description: '', detail: '' });
                folders.forEach(folder => {
                    items.push({
                        label: `  ${folder}`,
                        description: 'Workspace',
                        detail: ''
                    });
                });
            }

            // Add GitHub repos
            if (repos.length > 0) {
                if (items.length > 0) {
                    items.push({ label: '', description: '', detail: '' }); // Spacer
                }
                items.push({ label: '📦 GitHub Repositories', description: '', detail: '' });
                repos.forEach(repo => {
                    items.push({
                        label: `  ${repo.owner}/${repo.name}`,
                        description: `Indexed: ${repo.indexedAt.toLocaleDateString()}`,
                        detail: repo.url
                    });
                });
            }

            await vscode.window.showQuickPick(items, {
                placeHolder: 'Indexed Sources',
                canPickMany: false
            });
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
        vscode.commands.registerCommand('copilot-rag.clearIndex', async () => {
            await vectorStore.clearIndex();
            vscode.window.showInformationMessage('Vector index cleared!');
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
