# Web Search Fix - What I Did

## ✅ Problem Identified

Opencode was saying "I don't have internet access" because:
1. **`webfetch` tool wasn't enabled** in Opencode configuration
2. **Network access might be disabled**
3. **Agent wasn't being told to use the tool**

## ✅ Fixes Applied

### 1. Created `opencode.json` Configuration File

Created `/Users/bunny/Documents/GitHub/IDE/opencode.json` with:

```json
{
  "tools": {
    "webfetch": {
      "enabled": true,
      "requireApproval": false
    },
    "edit": { "enabled": true, "requireApproval": true },
    "write": { "enabled": true, "requireApproval": true },
    "bash": { "enabled": true, "requireApproval": true }
  },
  "network": {
    "allowed": true
  }
}
```

### 2. Enhanced Prompt Handling

Updated `chatThreadService.ts` to:
- Detect when user asks about web search
- Explicitly tell Opencode agent to use `webfetch` tool
- Add instruction: "Use the webfetch tool to search the internet"

### 3. Updated Opencode Service

Enhanced `opencodeService.ts` to:
- Check config when connecting
- Add web search hints in prompts
- Better detect webfetch tool usage

## 🚀 Next Steps (REQUIRED)

### **You MUST restart Opencode server:**

1. **Stop current Opencode server** (if running):
   - Press `Ctrl+C` in the terminal where it's running

2. **Restart Opencode server**:
   ```bash
   npx @opencode-ai/cli
   ```

3. **Verify config is loaded**:
   - Opencode should read `opencode.json` on startup
   - Check server logs for "webfetch enabled" or similar

4. **Test web search again**:
   - Try: "Search the web for war in 2026"
   - Should now use webfetch tool!

## 📍 Config File Location

The `opencode.json` file is in your project root:
```
/Users/bunny/Documents/GitHub/IDE/opencode.json
```

Opencode will automatically find it when you start the server from this directory.

## 🔍 How to Verify It's Working

After restarting Opencode:

1. **Check Opencode logs** - Should show webfetch tool is enabled
2. **Ask to search web** - Should use webfetch tool (you'll see "Web Search" in UI)
3. **Check network** - Opencode server needs internet access

## ⚠️ If Still Not Working

1. **Check Opencode server location**:
   - Make sure server is started from project root (where `opencode.json` is)
   - Or move `opencode.json` to Opencode's config directory

2. **Check Opencode version**:
   ```bash
   npx @opencode-ai/cli --version
   ```
   - Older versions might have different config format

3. **Manual config check**:
   ```bash
   # If using Opencode CLI
   opencode config get tools.webfetch.enabled
   ```

4. **Try explicit tool call**:
   - Ask: "Use the webfetch tool to search the web for..."

## 🎯 Expected Behavior After Fix

```
You: "Search the web for war in 2026"
    ↓
Opencode: [Recognizes webfetch tool is available]
    ↓
Opencode: [Uses webfetch tool]
    ↓
UI: "🔄 Tool: Web Search - Searching web: https://..."
    ↓
Opencode: Returns actual web content about war in 2026
```

**Restart the Opencode server and try again!**
