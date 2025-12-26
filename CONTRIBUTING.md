# Contributing to RAG Pilot

Thank you for your interest in contributing to RAG Pilot! 🎉

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- VS Code version, OS, and extension version
- Any relevant error messages from Output → Extension Host

### Suggesting Features

Feature requests are welcome! Please create an issue with:
- Clear description of the feature
- Use case / why it would be useful
- Any implementation ideas (optional)

### Pull Requests

1. **Fork the repository**
   ```bash
   git clone https://github.com/sudoecho1/RAG-Pilot.git
   cd RAG-Pilot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Update tests if applicable

5. **Test your changes**
   - Press `F5` to launch Extension Development Host
   - Test all affected functionality
   - Check for errors in Output → Extension Host

6. **Commit your changes**
   ```bash
   git commit -m 'Add some feature'
   ```

7. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

8. **Create a Pull Request**
   - Provide clear description of changes
   - Reference any related issues
   - Include screenshots/GIFs if UI changes

## Development Setup

### Prerequisites
- Node.js 18.x or higher
- VS Code 1.90.0 or higher
- GitHub Copilot extension

### Project Structure
```
rag-pilot/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── ragChatParticipant.ts # Chat participant implementation
│   ├── vectorStore.ts         # Vector database operations
│   └── gitHubRepoManager.ts   # GitHub repo management
├── package.json               # Extension manifest
├── tsconfig.json              # TypeScript configuration
└── esbuild.js                 # Build configuration
```

### Building
```bash
npm run compile      # Type check, lint, and build
npm run watch        # Watch mode for development
```

### Testing
- Press `F5` to launch Extension Development Host
- Test features in the new VS Code window
- Check console logs in Debug Console

## Code Guidelines

### TypeScript
- Use strict mode
- Add type annotations for public APIs
- Use `async/await` for asynchronous operations
- Handle errors gracefully with try/catch

### Naming Conventions
- Files: camelCase (e.g., `vectorStore.ts`)
- Classes: PascalCase (e.g., `VectorStore`)
- Functions/variables: camelCase (e.g., `indexWorkspace`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_CHUNK_SIZE`)

### Comments
- Add JSDoc comments for public functions
- Explain "why" not "what" in inline comments
- Keep comments up-to-date with code changes

## Questions?

Feel free to open an issue for any questions or clarifications!
