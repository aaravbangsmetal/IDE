# Opencode SDK Deep Integration - Complete

## ✅ What Was Done

### 1. **Replaced Void Agent System with Opencode SDK**

The `_runChatAgent` method in `chatThreadService.ts` has been completely replaced to use Opencode SDK instead of Void's LLM service.

**Before:** Used `_llmMessageService.sendLLMMessage()` (Void's agent system)
**After:** Uses `_opencodeService.sendPrompt()` (Opencode SDK)

### 2. **Thread-to-Session Mapping**

- Each Void thread now maps 1:1 to an Opencode session
- Sessions are created automatically when a thread starts
- Session IDs are stored in `_threadToSessionMap`

### 3. **Real-Time Event Handling**

- Subscribes to Opencode events for real-time updates
- Maps Opencode events to Void's UI state:
  - `message.streaming` → Updates chat display
  - `tool.used` → Shows tool execution
  - `permission.required` → Shows permission dialogs

### 4. **Permission System Integration**

- `approveLatestToolRequest()` now uses Opencode's permission API
- `rejectLatestToolRequest()` rejects Opencode permissions
- Falls back to Void logic if Opencode isn't connected

## 📁 Files Modified

1. **`src/vs/workbench/contrib/void/common/opencodeService.ts`**
   - Created Opencode service wrapper
   - Handles connection, sessions, prompts, events

2. **`src/vs/workbench/contrib/void/common/opencodeServiceTypes.ts`**
   - TypeScript types for Opencode integration

3. **`src/vs/workbench/contrib/void/browser/chatThreadService.ts`**
   - ✅ Replaced `_runChatAgent()` with Opencode version
   - ✅ Updated `approveLatestToolRequest()` for Opencode
   - ✅ Updated `rejectLatestToolRequest()` for Opencode
   - ✅ Added thread-to-session mapping helpers

## 🎯 How It Works

### Flow:

```
User types in chat → SidebarChat.tsx
    ↓
chatThreadService.addUserMessageAndStreamResponse()
    ↓
_runChatAgent() [NOW USES OPENCODE]
    ↓
1. Connect to Opencode (if not connected)
2. Create/get Opencode session for thread
3. Subscribe to events
4. Send prompt via opencodeService.sendPrompt()
5. Handle real-time events:
   - Stream text → Update UI
   - Tool calls → Show tool execution
   - Permissions → Show approval dialog
6. Add assistant message when complete
```

### Key Differences from Void Agents:

| Aspect | Void Agents | Opencode SDK |
|--------|-------------|--------------|
| **Backend** | Void's LLM service | Opencode server (localhost:4096) |
| **Tool Execution** | Void handles tools | Opencode agents handle tools |
| **Permissions** | Void's approval system | Opencode's permission system |
| **Sessions** | Void threads | Opencode sessions (mapped 1:1) |
| **Events** | Void callbacks | Opencode SSE events |

## 🚀 Usage

### Prerequisites:

1. **Start Opencode Server:**
   ```bash
   npx @opencode-ai/cli
   # Runs on http://localhost:4096
   ```

2. **Configure API Keys** (in Opencode):
   - Set your Anthropic/OpenAI/etc. API keys
   - Opencode handles model selection

### In Your IDE:

The integration is **automatic**! When users chat:

1. First message → Creates Opencode session
2. Subsequent messages → Uses existing session
3. Tool calls → Handled by Opencode agents
4. Permissions → Shown via Void's UI, approved via Opencode

## 🔧 Configuration

The service connects to `localhost:4096` by default. To change:

```typescript
await opencodeService.connect({
  hostname: '127.0.0.1',
  port: 4096,
  baseUrl: 'http://localhost:4096'
});
```

## ⚠️ Important Notes

1. **Void Agents Are Disabled**: The `_runChatAgent` method no longer uses Void's agent system
2. **Opencode Required**: Users must have Opencode server running
3. **Session Persistence**: Opencode sessions persist independently of Void threads
4. **Tool Execution**: All tools are executed by Opencode agents, not Void

## 🐛 Troubleshooting

### "Failed to connect to Opencode"
- Make sure Opencode server is running: `npx @opencode-ai/cli`
- Check it's on `localhost:4096`

### "Failed to create Opencode session"
- Check Opencode server logs
- Verify API keys are configured in Opencode

### Events not updating
- Check Opencode server is running
- Verify event subscription is working
- Check browser console for errors

## 📊 What's Next (Optional Enhancements)

1. **Better Event Handling**: Wait for `message.completed` event instead of timeout
2. **Permission ID Tracking**: Store permission IDs in stream state
3. **Session List UI**: Show Opencode sessions in sidebar
4. **File Diff Integration**: Map Opencode file changes to `VoidDiffEditor`
5. **Error Recovery**: Better retry logic for Opencode errors

## ✅ Status

**DEEP INTEGRATION COMPLETE** - Void agents are replaced with Opencode SDK!

The IDE now uses Opencode for all agentic tasks. Void's UI remains, but the backend is 100% Opencode.
