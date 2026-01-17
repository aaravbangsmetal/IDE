# Opencode SDK Integration for Void IDE

## ✅ Completed

1. **Installed Opencode SDK** (`@opencode-ai/sdk`)
2. **Created Opencode Service** (`opencodeService.ts`)
   - Full service wrapper following Void IDE patterns
   - Connection management (connect/disconnect)
   - Session management (create, list, delete, get)
   - Prompt/command sending
   - File operations (read, search)
   - Permission handling
   - Real-time event subscription

## 📋 Next Steps (2-3 hours remaining)

### 1. Wire Up UI Components (~1 hour)
   - Connect prompt box to `opencodeService.sendPrompt()`
   - Add session selector to sidebar
   - Display Opencode sessions in sidebar panel

### 2. Event Handling (~30 min)
   - Subscribe to events when session is active
   - Map Opencode events to existing tool display UI
   - Show real-time updates in sidebar

### 3. Permission System (~30 min)
   - Connect existing approval UI to Opencode permissions
   - Handle permission requests from Opencode

### 4. File Diff Integration (~30 min)
   - Map Opencode file changes to `VoidDiffEditor` component
   - Display diffs before applying changes

### 5. Commands (~30 min)
   - Add command palette commands:
     - "Opencode: Connect"
     - "Opencode: Create Session"
     - "Opencode: List Sessions"
     - "Opencode: Switch Session"

## 🎯 How to Use

### Prerequisites
1. **Install Opencode Server** (if not already installed):
   ```bash
   npm install -g @opencode-ai/cli
   # or
   npx @opencode-ai/cli
   ```

2. **Start Opencode Server**:
   ```bash
   opencode
   # Server runs on http://localhost:4096
   ```

### In Your IDE
```typescript
// Get the service
const opencodeService = accessor.get(IOpencodeService);

// Connect
await opencodeService.connect({
  hostname: '127.0.0.1',
  port: 4096
});

// Create session
const sessionId = await opencodeService.createSession('My Task');

// Send prompt
await opencodeService.sendPrompt(sessionId, 'Fix the bug in UserService.ts');

// Subscribe to events
await opencodeService.subscribeToEvents(sessionId);
opencodeService.onDidReceiveEvent(event => {
  console.log('Event:', event.type, event.properties);
});
```

## 🔧 Service API

### Connection
- `connect(config?)` - Connect to Opencode server
- `disconnect()` - Disconnect from server
- `isConnected` - Check connection status

### Sessions
- `createSession(title?)` - Create new session
- `listSessions()` - Get all sessions
- `getSession(id)` - Get session details
- `deleteSession(id)` - Delete session
- `setCurrentSession(id)` - Set active session

### Prompts & Commands
- `sendPrompt(sessionId, prompt, options?)` - Send prompt to agent
- `sendCommand(sessionId, command)` - Send command
- `runShell(sessionId, command)` - Run shell command

### File Operations
- `readFile(path)` - Read file content
- `searchFiles(query, type?)` - Find files
- `searchText(pattern)` - Search text in files

### Permissions
- `approvePermission(sessionId, permissionId, approved)` - Handle permissions

### Events
- `subscribeToEvents(sessionId)` - Subscribe to real-time events
- `onDidReceiveEvent` - Event emitter
- `onDidToolCall` - Tool call events
- `onDidPermissionRequest` - Permission request events

## 💰 Cost

- **Opencode Platform**: FREE ✅
- **AI Models**: Pay providers directly
  - Use your own API keys (Anthropic, OpenAI, etc.)
  - Or use Opencode Zen free tier models

## 🚀 Benefits

- ✅ No subscription fees
- ✅ Full control (local server)
- ✅ Works with any AI provider
- ✅ Real-time event updates
- ✅ Type-safe TypeScript API
- ✅ Matches your existing architecture
