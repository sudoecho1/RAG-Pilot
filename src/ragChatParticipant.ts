import * as vscode from 'vscode';
import { VectorStore } from './vectorStore';

export class RagChatParticipant {
    constructor(private vectorStore: VectorStore) {}

    async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        try {
            // Check if index exists
            const hasIndex = await this.vectorStore.hasIndex();
            if (!hasIndex) {
                stream.markdown('⚠️ No vector index found. Please run the **RAG: Index Workspace** command first.\n\n');
                return { metadata: { command: '' } };
            }

            // Retrieve relevant context using vector search
            stream.progress('Searching for relevant context...');
            const relevantDocs = await this.vectorStore.search(request.prompt, 5);

            if (relevantDocs.length === 0) {
                stream.markdown('No relevant context found in the indexed workspace.\n\n');
            }

            // Build augmented prompt with retrieved context
            let augmentedPrompt = 'You are a helpful coding assistant. Use the following context from the workspace to answer the user\'s question:\n\n';
            
            if (relevantDocs.length > 0) {
                augmentedPrompt += '# Retrieved Context\n\n';
                for (const doc of relevantDocs) {
                    const source = doc.metadata.source === 'github' 
                        ? `[${doc.metadata.repo}] ${doc.metadata.file}`
                        : doc.metadata.file;
                    augmentedPrompt += `## ${source}\n`;
                    augmentedPrompt += '```\n';
                    augmentedPrompt += doc.text;
                    augmentedPrompt += '\n```\n\n';
                }
            }

            augmentedPrompt += `# User Question\n${request.prompt}\n\n`;
            augmentedPrompt += 'Please provide a helpful answer based on the context above.';

            // Get language model
            const models = await vscode.lm.selectChatModels({ 
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('❌ No Copilot model available. Please ensure GitHub Copilot is installed and you are signed in.\n\n');
                return { metadata: { command: '' } };
            }

            const model = models[0];

            // Create messages for the chat
            const messages = [
                vscode.LanguageModelChatMessage.User(augmentedPrompt)
            ];

            // Stream the response
            stream.progress('Generating response with Copilot...');
            const chatResponse = await model.sendRequest(messages, {}, token);

            for await (const fragment of chatResponse.text) {
                stream.markdown(fragment);
            }

            // Add references to sources
            if (relevantDocs.length > 0) {
                stream.markdown('\n\n---\n📚 **Sources:**\n');
                for (const doc of relevantDocs) {
                    const source = doc.metadata.source === 'github' 
                        ? `[${doc.metadata.repo}] ${doc.metadata.file}`
                        : doc.metadata.file;
                    stream.markdown(`- ${source}\n`);
                }
            }

            return { metadata: { command: '' } };

        } catch (err) {
            if (err instanceof vscode.LanguageModelError) {
                console.error('Language Model Error:', err.message, err.code, err.cause);
                stream.markdown(`❌ Error: ${err.message}\n`);
            } else {
                console.error('Unexpected error:', err);
                stream.markdown('❌ An unexpected error occurred.\n');
            }
            return { metadata: { command: '' } };
        }
    }
}
