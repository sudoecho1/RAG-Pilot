# Changelog

All notable changes to the "RAG Pilot" extension will be documented in this file.

## [Unreleased]

### Planned Features
- Adjustable chunk size and overlap settings
- Export/import index functionality
- Advanced search filters
- Support for more file types
- Integration with other language models
- Batch indexing operations

## [1.0.0] - 2025-12-27

### Added
- **MCP Server Integration**: Full Model Context Protocol (MCP) support - automatically discovers and invokes MCP tools continuously during conversations
- **Custom Slash Commands**: Dynamic slash command discovery from `.github/prompts/*.prompt.md` files in your workspace
- **Conversation History**: Last 6 messages are included in context for better continuity (with token truncation)
- **File Reference Support**: Attach files to chat or reference them by name in your queries
- **Interactive Source Management**: Right-click indexed sources to remove individual repos or folders from the index
- **Configurable Embedding Models**: Choose from 4 embedding models via VS Code settings:
  - `Xenova/all-MiniLM-L6-v2` (384 dims, 23MB) - Fastest, good for general use
  - `Xenova/bge-small-en-v1.5` (384 dims, 33MB) - Balanced speed and quality
  - `Xenova/bge-base-en-v1.5` (768 dims, 130MB) - State-of-the-art quality (default)
  - `Xenova/all-mpnet-base-v2` (768 dims, 120MB) - Best semantic understanding
- **Slash Command Persistence**: Slash commands persist across the conversation without re-typing

### Improved
- **Search Quality**: Reduced results from 5-10 to top 3 most relevant snippets for better signal-to-noise ratio
- **Default Embedding Model**: Upgraded from all-MiniLM-L6-v2 to bge-base-en-v1.5 for significantly better retrieval accuracy
- **Activation Logging**: Added comprehensive logging for debugging activation and tool execution
- **Score Visibility**: Vector search scores now logged to console for transparency

### Fixed
- Extension activation on startup (no longer requires re-activation per message)
- Empty vector index issues (proper initialization and re-indexing workflow)
- "Item with id already exists" error when removing sources (index rebuilding now creates new items without ID conflicts)
- Slash command detection now works from prompt text using regex pattern matching

### Technical Changes
- MCP tool invocation loop: Streams all response parts, executes tools, adds results, and continues until no more tools are called
- Slash command regex: `/([a-zA-Z0-9\-_]+)` matches commands in user messages
- Index rebuilding: Filters items and creates new entries without IDs to prevent conflicts
- Model configuration: Settings path `copilot-rag.embeddingModel` with dropdown and detailed descriptions

### Breaking Changes
- Changing embedding models requires clearing and re-indexing all sources (different dimensional embeddings are incompatible)

## [0.1.0] - 2025-12-26

### Added
- Initial release of RAG Pilot
- Semantic search using vector embeddings (all-MiniLM-L6-v2)
- GitHub Copilot integration via Language Model API
- Chat participant with `@rag` command
- Index entire workspace for vector search
- Index specific folders via right-click context menu
- Index individual files or multiple selected files
- Download and index GitHub repositories
- List all indexed sources (workspace folders, files, and repos)
- Remove repositories from index
- Clear vector index command
- Keyboard shortcut (`Ctrl+Shift+R` / `Cmd+Shift+R`) to open RAG chat
- Persistent storage of embeddings and indexed sources
- Configurable include/exclude patterns for indexing
- Source citations in chat responses
- Progress notifications for indexing operations

### Features
- **Workspace Indexing**: Index your entire workspace or specific folders
- **File Indexing**: Select and index individual files or groups of files
- **GitHub Integration**: Clone and index external GitHub repositories
- **Smart Context**: Retrieves top 5 most relevant code snippets for each query
- **Sticky Chat Mode**: `@rag` remains active throughout the chat session
- **Local Processing**: Embedding model runs locally (no external API calls)

### Technical Details
- Embedding Model: Xenova/all-MiniLM-L6-v2
- Vector Store: Vectra (local file-based)
- Chunk Size: 100 lines with 20-line overlap
- Storage: VS Code global storage directory
