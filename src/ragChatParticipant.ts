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
        console.log('=== RAG CHAT PARTICIPANT INVOKED ===');
        console.log('Request prompt:', request.prompt);
        console.log('Request command:', request.command);
        
        try {
            // Check if index exists
            const hasIndex = await this.vectorStore.hasIndex();
            if (!hasIndex) {
                stream.markdown('⚠️ No vector index found. Please run the **RAG: Index Workspace** command first.\n\n');
                return { metadata: { command: '' } };
            }

            // Retrieve relevant context using vector search (top 3 most relevant)
            stream.progress('Searching for relevant context...');
            const relevantDocs = await this.vectorStore.search(request.prompt, 3);

            console.log(`Vector search found ${relevantDocs.length} documents`);
            if (relevantDocs.length > 0) {
                console.log('Top 3 scores:', relevantDocs.map(d => `${d.score.toFixed(3)} - ${d.metadata.file?.split('/').pop()}`));
                console.log('Top result source:', relevantDocs[0].metadata.source, relevantDocs[0].metadata.repo || relevantDocs[0].metadata.file);
            }

            if (relevantDocs.length === 0) {
                stream.markdown('No relevant context found in the indexed workspace.\n\n');
            }

            // Collect user-provided file references
            const userProvidedFiles: { uri: vscode.Uri; content: string }[] = [];
            
            // Debug: log what references we're getting
            console.log('Request references:', request.references.length);
            for (const ref of request.references) {
                console.log('Reference:', ref.id, typeof ref.value, ref.value);
                
                // Handle file references - try multiple formats
                if ((ref.id === 'vscode.file' || ref.id === 'file') && ref.value instanceof vscode.Uri) {
                    try {
                        const fileContent = await vscode.workspace.fs.readFile(ref.value);
                        userProvidedFiles.push({
                            uri: ref.value,
                            content: new TextDecoder().decode(fileContent)
                        });
                    } catch (error) {
                        console.error(`Error reading file ${ref.value.fsPath}:`, error);
                    }
                } else if (ref.value && typeof ref.value === 'object' && 'uri' in ref.value) {
                    // Handle case where value is an object with uri property
                    try {
                        const uri = (ref.value as any).uri as vscode.Uri;
                        const fileContent = await vscode.workspace.fs.readFile(uri);
                        userProvidedFiles.push({
                            uri: uri,
                            content: new TextDecoder().decode(fileContent)
                        });
                    } catch (error) {
                        console.error(`Error reading file from reference:`, error);
                    }
                }
            }

            // Also try to extract filename from prompt if mentioned
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && userProvidedFiles.length === 0) {
                const fileNameMatch = request.prompt.match(/(?:review|analyze|check|look at|see)\s+([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z]+)/i);
                if (fileNameMatch) {
                    const fileName = fileNameMatch[1];
                    try {
                        const files = await vscode.workspace.findFiles(`**/${fileName}`, null, 1);
                        if (files.length > 0) {
                            const fileContent = await vscode.workspace.fs.readFile(files[0]);
                            userProvidedFiles.push({
                                uri: files[0],
                                content: new TextDecoder().decode(fileContent)
                            });
                        }
                    } catch (error) {
                        console.error(`Error finding/reading file ${fileName}:`, error);
                    }
                }
            }

            // Build augmented prompt with retrieved context
            let augmentedPrompt = 'You are a helpful coding assistant with access to MCP tools and workspace context.\n\n';
            
            // Check if a slash command was used (either current or from history)
            let activeCommand = request.command;
            
            // If no command from VS Code, check if prompt starts with /
            if (!activeCommand && request.prompt.trim().startsWith('/')) {
                const match = request.prompt.trim().match(/^\/([a-zA-Z0-9\-_]+)/);
                if (match) {
                    activeCommand = match[1];
                    console.log('Detected slash command from prompt:', activeCommand);
                }
            }
            
            // If still no command in current request, check history for most recent command
            if (!activeCommand && context.history.length > 0) {
                for (let i = context.history.length - 1; i >= 0; i--) {
                    const message = context.history[i];
                    if (message instanceof vscode.ChatRequestTurn) {
                        // Check for command in the turn
                        if (message.command) {
                            activeCommand = message.command;
                            console.log('Found active command from history:', activeCommand);
                            break;
                        }
                        // Also check if the prompt started with /
                        const historyMatch = message.prompt.trim().match(/^\/([a-zA-Z0-9\-_]+)/);
                        if (historyMatch) {
                            activeCommand = historyMatch[1];
                            console.log('Found active slash command from history prompt:', activeCommand);
                            break;
                        }
                    }
                }
            }
            
            // Load and apply the active command prompt
            if (activeCommand) {
                console.log('Active slash command:', activeCommand);
                console.log('Looking for prompt file:', `.github/prompts/${activeCommand}.prompt.md`);
                
                // Try to load custom prompt from .github/prompts/
                try {
                    const promptFiles = await vscode.workspace.findFiles(`.github/prompts/${activeCommand}.prompt.md`, null, 1);
                    console.log('Found prompt files:', promptFiles.length, promptFiles.map(f => f.fsPath));
                    
                    if (promptFiles.length > 0) {
                        const promptContent = await vscode.workspace.fs.readFile(promptFiles[0]);
                        const promptText = new TextDecoder().decode(promptContent);
                        augmentedPrompt += `# Custom Prompt: /${activeCommand}\n`;
                        augmentedPrompt += promptText + '\n\n';
                        console.log(`Loaded custom prompt from ${promptFiles[0].fsPath}`);
                    } else {
                        // Try alternate search pattern
                        const allPrompts = await vscode.workspace.findFiles('.github/prompts/*.prompt.md');
                        console.log('All available prompt files:', allPrompts.map(f => f.fsPath));
                        
                        // Prompt file not found - show warning to user
                        stream.markdown(`⚠️ Custom prompt file not found: \`.github/prompts/${activeCommand}.prompt.md\`\n\n`);
                        console.warn(`Custom prompt file not found: .github/prompts/${activeCommand}.prompt.md`);
                    }
                } catch (error) {
                    console.error('Error loading custom prompt:', error);
                    stream.markdown(`⚠️ Error loading custom prompt /${activeCommand}: ${error}\n\n`);
                }
            }
            
            // Add instruction about available tools
            if (vscode.lm.tools.length > 0) {
                augmentedPrompt += '# Available Tools\n';
                augmentedPrompt += 'You have access to the following MCP tools that you SHOULD use when appropriate:\n';
                for (const tool of vscode.lm.tools) {
                    augmentedPrompt += `- **${tool.name}**: ${tool.description || 'No description'}\n`;
                }
                augmentedPrompt += '\nWhen the user asks you to run commands or interact with systems, USE THESE TOOLS instead of just describing them.\n\n';
            }
            
            // Add conversation history for context continuity
            console.log('Chat context history length:', context.history.length);
            if (context.history.length > 0) {
                augmentedPrompt += '# Previous Conversation\n';
                augmentedPrompt += 'Here is the recent conversation history for context:\n\n';
                // Include last few messages for context (limit to avoid token overflow)
                const recentHistory = context.history.slice(-6);
                for (const message of recentHistory) {
                    console.log('Message type:', message.constructor.name);
                    if (message instanceof vscode.ChatRequestTurn) {
                        const cmdPrefix = message.command ? `/${message.command} ` : '';
                        augmentedPrompt += `**User**: ${cmdPrefix}${message.prompt}\n\n`;
                        console.log('User message:', cmdPrefix + message.prompt);
                    } else if (message instanceof vscode.ChatResponseTurn) {
                        // Extract text from response
                        let responseText = '';
                        for (const part of message.response) {
                            if (part instanceof vscode.ChatResponseMarkdownPart) {
                                responseText += part.value.value;
                            }
                        }
                        if (responseText) {
                            const truncated = responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText;
                            augmentedPrompt += `**Assistant**: ${truncated}\n\n`;
                            console.log('Assistant response length:', responseText.length);
                        }
                    }
                }
                augmentedPrompt += '\n';
            } else {
                console.log('No conversation history available');
            }
            
            // Add user-provided files first
            if (userProvidedFiles.length > 0) {
                augmentedPrompt += '# User-Provided Files\n\n';
                for (const file of userProvidedFiles) {
                    const fileName = file.uri.fsPath.split('/').pop() || file.uri.fsPath;
                    augmentedPrompt += `## ${fileName}\n`;
                    augmentedPrompt += '```\n';
                    augmentedPrompt += file.content;
                    augmentedPrompt += '\n```\n\n';
                }
            }

            // Add RAG-retrieved context
            if (relevantDocs.length > 0) {
                augmentedPrompt += '# Retrieved Context from Vector Search\n\n';
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
            augmentedPrompt += '# CRITICAL ACTION INSTRUCTIONS:\n';
            augmentedPrompt += 'YOU MUST TAKE ACTION IMMEDIATELY. DO NOT ASK FOR PERMISSION.\n';
            augmentedPrompt += '- When user says "yes", "proceed", "do it", "first", or similar: EXECUTE THE TASK NOW\n';
            augmentedPrompt += '- When user asks to solve a challenge, run commands, analyze data: USE THE TOOLS IMMEDIATELY\n';
            augmentedPrompt += '- Do NOT create todo lists or ask if you should proceed - just DO IT\n';
            augmentedPrompt += '- Do NOT say "would you like me to" or "should I" - TAKE ACTION\n';
            augmentedPrompt += '- Run actual commands using the MCP tools, don\'t just describe what you would do\n';
            augmentedPrompt += '- If you need multiple tool calls to accomplish a task, make them sequentially\n\n';
            augmentedPrompt += 'START EXECUTING NOW based on the context and user request above.\n';

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

            // Get available MCP tools
            const tools = vscode.lm.tools;
            console.log(`Found ${tools.length} available MCP tools`);

            // Stream the response with tool support - loop until no more tool calls
            stream.progress('Generating response with Copilot...');
            let continueLoop = true;
            let totalToolCalls = 0;
            
            while (continueLoop && !token.isCancellationRequested) {
                const chatResponse = await model.sendRequest(
                    messages, 
                    { 
                        justification: 'Answering user question with RAG context and MCP tools',
                        tools: tools.length > 0 ? [...tools] : undefined
                    }, 
                    token
                );

                let hasToolCalls = false;
                const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
                
                // Collect all parts from this response
                for await (const part of chatResponse.stream) {
                    console.log('Stream part type:', (part as any).constructor?.name || typeof part);
                    
                    if (part instanceof vscode.LanguageModelTextPart) {
                        assistantParts.push(part);
                        stream.markdown(part.value);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        assistantParts.push(part);
                        hasToolCalls = true;
                        totalToolCalls++;
                        console.log(`Tool call #${totalToolCalls}: ${part.name} with input:`, part.input);
                        stream.progress(`Using tool: ${part.name}...`);
                    }
                }
                
                if (hasToolCalls) {
                    // Add assistant message with all parts (text + tool calls)
                    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
                    
                    // Execute all tool calls and collect results
                    const toolResults: vscode.LanguageModelToolResultPart[] = [];
                    for (const part of assistantParts) {
                        if (part instanceof vscode.LanguageModelToolCallPart) {
                            try {
                                console.log(`Invoking tool ${part.name}...`);
                                const toolResult = await vscode.lm.invokeTool(
                                    part.name,
                                    { 
                                        input: part.input,
                                        toolInvocationToken: request.toolInvocationToken
                                    },
                                    token
                                );
                                
                                console.log(`Tool ${part.name} completed with result length:`, toolResult.content.length);
                                toolResults.push(new vscode.LanguageModelToolResultPart(part.callId, toolResult.content));
                            } catch (error) {
                                console.error(`Error invoking tool ${part.name}:`, error);
                                stream.markdown(`\n\n⚠️ Error using tool ${part.name}: ${error}\n\n`);
                            }
                        }
                    }
                    
                    // Add tool results to messages for next iteration
                    if (toolResults.length > 0) {
                        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
                        console.log(`Added ${toolResults.length} tool results, continuing loop...`);
                        // Continue loop to get model's response to tool results
                    } else {
                        continueLoop = false;
                    }
                } else {
                    // No tool calls in this response, we're done
                    console.log('No tool calls in this response, ending loop');
                    continueLoop = false;
                }
            }
            
            console.log(`Total tool calls made: ${totalToolCalls}`);
            if (totalToolCalls === 0) {
                console.log('No tool calls were made by the model');
            }

            // Add references to sources
            if (relevantDocs.length > 0 || userProvidedFiles.length > 0) {
                stream.markdown('\n\n---\n📚 **Sources:**\n');
                
                // List user-provided files
                for (const file of userProvidedFiles) {
                    const fileName = file.uri.fsPath.split('/').pop() || file.uri.fsPath;
                    stream.markdown(`- ${fileName} (user-provided)\n`);
                }
                
                // List RAG-retrieved docs
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
