# How to Enable Web Search in Opencode

## 🔍 Problem

Opencode is saying "I don't have internet access" when you ask it to search the web. This means the `webfetch` tool isn't enabled or configured properly.

## ✅ Solution: Configure Opencode to Enable Web Search

### Step 1: Check/Create `opencode.json` Config File

Opencode needs a configuration file to enable web search. Create or edit `opencode.json` in your project root or Opencode config directory:

```json
{
  "tools": {
    "webfetch": {
      "enabled": true,
      "requireApproval": false
    },
    "edit": {
      "enabled": true,
      "requireApproval": true
    },
    "write": {
      "enabled": true,
      "requireApproval": true
    },
    "bash": {
      "enabled": true,
      "requireApproval": true
    }
  },
  "network": {
    "allowed": true
  }
}
```

### Step 2: Restart Opencode Server

After updating the config:

```bash
# Stop Opencode server (Ctrl+C)
# Then restart it
npx @opencode-ai/cli
```

### Step 3: Verify Web Search is Enabled

Check Opencode config via SDK:

```typescript
const config = await client.config.get();
console.log(config.data.tools); // Should show webfetch enabled
```

## 🎯 Alternative: Enable via Opencode CLI

If you're using Opencode CLI, you can enable web search:

```bash
opencode config set tools.webfetch.enabled true
opencode config set network.allowed true
```

## 📝 What I Just Added to the Integration

I've updated the integration to:

1. **Prompt Enhancement**: When you ask about web search, it now hints to the agent that `webfetch` tool is available
2. **Better Tool Detection**: Enhanced event handling to properly detect `webfetch` tool usage
3. **UI Display**: Shows "Web Search" instead of generic tool name

## 🔧 Quick Fix

The easiest way to enable web search right now:

1. **Create `opencode.json`** in your project root:
   ```json
   {
     "tools": {
       "webfetch": { "enabled": true }
     }
   }
   ```

2. **Restart Opencode server**

3. **Try again**: "Search the web for war in 2026"

## ⚠️ Important Notes

- **Network Access**: Opencode server needs internet access to fetch web pages
- **Permissions**: If `requireApproval: true`, you'll see a permission dialog
- **Model Capability**: Some models might not know about webfetch tool - the prompt enhancement helps with this

## 🐛 Still Not Working?

1. **Check Opencode logs**: Look for errors about webfetch tool
2. **Verify network**: Make sure Opencode server can access the internet
3. **Check model**: Some models might need explicit instruction to use tools
4. **Try explicit prompt**: "Use the webfetch tool to search the web for..."

## 📊 Expected Behavior After Fix

When web search is enabled:

```
You: "Search the web for war in 2026"
    ↓
Opencode: [Uses webfetch tool]
    ↓
UI Shows: "🔄 Tool: Web Search - Searching web: https://..."
    ↓
Opencode: Returns web content about war in 2026
```

Try creating the `opencode.json` file and restarting the server!
