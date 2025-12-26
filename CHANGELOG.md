# Changelog

All notable changes to the "RAG Pilot" extension will be documented in this file.

## [0.0.1] - 2025-12-26

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

## [Unreleased]

### Planned Features
- Custom embedding model selection
- Adjustable chunk size and overlap settings
- Export/import index functionality
- Advanced search filters
- Support for more file types
- Integration with other language models
