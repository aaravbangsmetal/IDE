# Codex Integration Guide for Void IDE

This document describes the Codex integration infrastructure that has been set up in Void IDE. The integration is ready for when the `codex-rs` workspace is added to the project.

## Architecture Overview

The Codex integration follows a similar pattern to other Void IDE services:

```
TypeScript (Browser/Renderer Process)
    ↓ IPC Channel
TypeScript (Main Process) - CodexChannel
    ↓ JSON-RPC over stdio
Rust CLI Process - codex command
    ↓ (when codex-rs is integrated)
Codex Engine (Rust)
```

## What's Been Implemented

### 1. Rust CLI Integration

**Files:**
- `cli/src/commands/args.rs` - Added `CodexArgs` and `Commands::Codex` variant
- `cli/src/commands/codex.rs` - Codex command handler with JSON-RPC server
- `cli/src/bin/code/main.rs` - Added Codex command routing

**What it does:**
- Provides a `code codex` command that runs a JSON-RPC server
- Supports communication via stdin/stdout, socket, or TCP port
- Currently has a placeholder implementation that will be replaced when codex-rs is integrated

### 2. TypeScript Service Integration

**Files:**
- `src/vs/workbench/contrib/void/electron-main/codexChannel.ts` - Main process channel
- `src/vs/workbench/contrib/void/common/codexService.ts` - Browser process service
- `src/vs/code/electron-main/app.ts` - Channel registration

**What it does:**
- Spawns the Rust CLI process when `codexService.start()` is called
- Manages process lifecycle (start/stop)
- Provides IPC communication between browser and main process
- Handles JSON-RPC communication with the Rust process

## Next Steps: Integrating codex-rs

### Step 1: Add codex-rs Workspace

Copy the `codex-rs/` directory into the project root, or add it as a git submodule:

```bash
# Option 1: Copy directory
cp -r /path/to/codex-rs/ /path/to/void-ide/

# Option 2: Git submodule
git submodule add https://github.com/your-org/codex-rs.git codex-rs
```

### Step 2: Update CLI Cargo.toml

Add Codex dependencies to `cli/Cargo.toml`:

```toml
[dependencies]
codex-core = { path = "../codex-rs/core" }
codex-protocol = { path = "../codex-rs/codex-protocol" }
# ... other codex-rs dependencies as needed
```

### Step 3: Update codex.rs Command Handler

Replace the placeholder implementation in `cli/src/commands/codex.rs`:

```rust
use codex_core::Codex;
use codex_core::config::Config;
use codex_core::auth::AuthManager;
use codex_core::models_manager::ModelsManager;
use codex_core::skills::SkillsManager;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::SessionSource;
use codex_core::agent::AgentControl;
use std::sync::Arc;

// In command_codex function:
let config = Config::load(...)?;
let auth_manager = Arc::new(AuthManager::new(...));
let models_manager = Arc::new(ModelsManager::new(...));
let skills_manager = Arc::new(SkillsManager::new(...));

let CodexSpawnOk { codex, thread_id } = Codex::spawn(
    config,
    auth_manager,
    models_manager,
    skills_manager,
    InitialHistory::New,
    SessionSource::VsCode, // or create Void variant
    AgentControl::default(),
).await?;

// Update serve_codex_stream to use actual Codex:
let dispatcher = new_json_rpc()
    .methods(codex)
    .register_async("codex/submit", |op: CodexOp, codex: &Codex| async move {
        codex.submit(op).await.map_err(|e| AnyError::from(e))
    })
    .register_async("codex/next_event", |_: (), codex: &Codex| async move {
        codex.next_event().await.map_err(|e| AnyError::from(e))
    })
    .register_async("codex/agent_status", |_: (), codex: &Codex| async move {
        Ok(codex.agent_status().borrow().clone())
    })
    .build();
```

### Step 4: Update TypeScript Service Types

Update `codexService.ts` and `codexChannel.ts` to match Codex's actual types:

```typescript
// Update CodexSubmitParams to match CodexOp enum
export interface CodexSubmitParams {
  op: 'UserInput' | 'Interrupt' | 'ResolveElicitation' | 'Shutdown' | ...;
  payload: {
    // Match actual CodexOp payload structure
  };
}

// Update CodexEvent to match EventMsg enum
export interface CodexEvent {
  type: 'ToolCall' | 'ItemStarted' | 'ItemCompleted' | 'TurnCompleted' | ...;
  data: {
    // Match actual event structure
  };
}
```

### Step 5: Integrate with Chat System

Update `chatThreadService.ts` to optionally use Codex:

```typescript
import { ICodexService } from '../common/codexService.js';

// In ChatThreadService constructor:
@ICodexService private readonly codexService: ICodexService,

// Optionally route agent mode to Codex:
if (chatMode === 'agent' && useCodex) {
  await this.codexService.start();
  await this.codexService.submit({
    op: 'UserInput',
    payload: { items: [...], final_output_json_schema: null }
  });

  // Listen for events
  this.codexService.onCodexEvent(event => {
    // Handle Codex events
  });
}
```

## API Reference

### CodexService (Browser Process)

```typescript
interface ICodexService {
  start(): Promise<{ success: boolean; message: string }>;
  stop(): Promise<{ success: boolean }>;
  submit(params: CodexSubmitParams): Promise<{ success: boolean; requestId?: string }>;
  nextEvent(params?: CodexNextEventParams): Promise<any>;
  agentStatus(): Promise<CodexAgentStatus>;
  ping(): Promise<{ status: string }>;
  readonly onCodexEvent: Event<CodexEvent>;
}
```

### CodexChannel (Main Process)

The channel handles:
- Process spawning and lifecycle
- JSON-RPC communication
- Event forwarding

## Testing

### Test Rust CLI

```bash
cd cli
cargo run -- codex --help
cargo run -- codex  # Runs JSON-RPC server on stdin/stdout
```

### Test TypeScript Integration

```typescript
// In browser process
const codexService = accessor.get(ICodexService);
await codexService.start();
await codexService.ping(); // Should return { status: 'ok' }
await codexService.submit({
  op: 'UserInput',
  payload: { items: [{ text: 'Hello' }] }
});
```

## Troubleshooting

### Codex process won't start

1. Check that the CLI binary exists: `which code` or check bundled binary path
2. Check logs in main process: Look for CodexChannel errors
3. Verify Rust CLI compiles: `cd cli && cargo build`

### JSON-RPC communication fails

1. Verify the Rust process is receiving stdin: Check `codex.rs` logs
2. Check JSON-RPC format: Should be `{"jsonrpc":"2.0","method":"...","params":{},"id":1}\n`
3. Verify event parsing: Check `codexChannel.ts` line parsing logic

### Events not received

1. Check event emitter registration in `codexChannel.ts`
2. Verify IPC channel registration in `app.ts`
3. Check service registration in `codexService.ts`

## Notes

- The integration is designed to be non-blocking - Codex runs in a separate process
- JSON-RPC is used for communication (line-delimited JSON)
- The Rust CLI process can be restarted without affecting the IDE
- Events are streamed in real-time from Codex to the IDE

## Future Enhancements

- [ ] Add Codex configuration UI
- [ ] Support multiple Codex sessions
- [ ] Add Codex status indicator in UI
- [ ] Integrate with existing tool calling system
- [ ] Add approval flow UI for Codex operations
- [ ] Support Codex's multi-agent features
