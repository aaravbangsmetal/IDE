# Web Search Support in Opencode Integration

## ✅ Yes, Opencode CAN Search the Web!

Opencode has a built-in **`webfetch`** tool that allows agents to:
- Fetch web pages from URLs
- Read online documentation
- Search for information on the internet
- Pull content from websites

## 🔧 How It Works

### Automatic Tool Usage

When you ask Opencode to search the web, the agent **automatically** uses the `webfetch` tool:

```
User: "Search for the latest React documentation"
    ↓
Opencode Agent: Uses webfetch tool
    ↓
Fetches: https://react.dev (or relevant URLs)
    ↓
Returns: Web content to the chat
```

### Example Prompts That Trigger Web Search

- "Search the web for..."
- "Look up..."
- "Find information about..."
- "What's the latest on..."
- "Check the docs for..."

## 🎯 Integration Status

✅ **Fully Integrated** - The deep integration already supports web search:

1. **Event Handling**: Captures `webfetch` tool calls
2. **UI Display**: Shows "Web Search" in tool execution status
3. **Real-time Updates**: Displays web search progress
4. **Results**: Web content appears in chat responses

## 📊 How It's Displayed

When Opencode uses web search, you'll see:

```
🔄 Tool: Web Search
   Searching web: https://example.com
   ...
✅ Web search complete
```

## ⚙️ Configuration

Web search is **enabled by default** in Opencode. To configure:

1. **Opencode Server Config** (`opencode.json`):
   ```json
   {
     "tools": {
       "webfetch": {
         "enabled": true,
         "requireApproval": false  // or true to ask permission
       }
     }
   }
   ```

2. **Permission Settings**:
   - If `requireApproval: true`, you'll see a permission dialog
   - Approve/reject via the existing approval UI

## 🌐 What Web Search Can Do

### ✅ Supported:
- Fetch specific URLs
- Read web page content
- Extract text from HTML
- Pull documentation
- Get information from websites

### ❌ Not Supported (by default):
- Google/Bing-style search engine queries
- Ranking/search results pages
- Image search
- Video search

**Note**: For full search engine integration, you'd need to add a custom tool that wraps Google/Bing APIs.

## 🚀 Usage Example

Just ask naturally:

```
User: "What's the latest version of TypeScript? Search the web for it."

Agent: [Uses webfetch tool]
       [Fetches TypeScript website]
       "The latest version of TypeScript is 5.x..."
```

## 🔍 Troubleshooting

### Web search not working?

1. **Check Opencode Config**: Make sure `webfetch` tool is enabled
2. **Check Permissions**: If approval required, approve the permission request
3. **Check Network**: Opencode server needs internet access
4. **Check Logs**: Look at Opencode server logs for errors

### Web search requires approval?

- You'll see a permission dialog
- Click "Approve" to allow web search
- Or configure `requireApproval: false` in Opencode config

## 📝 Summary

**Web search is fully supported!** Just ask Opencode to search the web, and it will automatically use the `webfetch` tool. The integration handles everything - you don't need to do anything special.
