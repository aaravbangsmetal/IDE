/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Codex Channel - manages communication with the Rust Codex CLI process
// Registered in app.ts

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ChildProcess, spawn } from 'child_process';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export interface CodexEvent {
	type: 'event' | 'error' | 'status';
	data: any;
}

export interface CodexSubmitParams {
	op: 'UserInput' | 'Interrupt' | 'ResolveElicitation' | 'Shutdown';
	payload: any;
}

export interface CodexNextEventParams {
	timeout?: number;
}

export interface CodexAgentStatus {
	status: string;
	// TODO: Add more fields when codex-rs is integrated
}

export class CodexChannel implements IServerChannel {
	private codexProcess: ChildProcess | null = null;
	private eventEmitter = new Emitter<CodexEvent>();
	private readonly logService: ILogService;
	private readonly environmentService: IEnvironmentMainService;

	constructor(
		@ILogService logService: ILogService,
		@IEnvironmentMainService environmentService: IEnvironmentMainService
	) {
		this.logService = logService;
		this.environmentService = environmentService;
	}

	listen(_: unknown, event: string): Event<any> {
		if (event === 'onCodexEvent') {
			return this.eventEmitter.event;
		}
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'start') {
				return await this._start();
			} else if (command === 'stop') {
				return await this._stop();
			} else if (command === 'submit') {
				const p: CodexSubmitParams = params;
				return await this._submit(p);
			} else if (command === 'nextEvent') {
				const p: CodexNextEventParams = params;
				return await this._nextEvent(p);
			} else if (command === 'agentStatus') {
				return await this._agentStatus();
			} else if (command === 'ping') {
				return await this._ping();
			}
			throw new Error(`Unknown command: ${command}`);
		} catch (error) {
			this.logService.error(`CodexChannel error in ${command}:`, error);
			throw error;
		}
	}

	private async _start(): Promise<{ success: boolean; message: string }> {
		if (this.codexProcess) {
			return { success: false, message: 'Codex process already running' };
		}

		try {
			// Spawn the Rust CLI codex command
			const cliPath = this._getCliPath();
			const args = this._getCliArgs();
			const cwd = this.environmentService.isBuilt
				? this.environmentService.appRoot
				: join(this.environmentService.appRoot, 'cli');

			this.logService.info(`Starting Codex process: ${cliPath} ${args.join(' ')}`);

			this.codexProcess = spawn(cliPath, args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				cwd,
			});

			// Set up stdout/stderr handlers
			if (this.codexProcess.stdout) {
				const rl = createInterface({
					input: this.codexProcess.stdout,
					crlfDelay: Infinity,
				});

				rl.on('line', (line) => {
					try {
						const event = JSON.parse(line);
						this.eventEmitter.fire({
							type: 'event',
							data: event,
						});
					} catch (e) {
						// Not JSON, treat as log output
						this.logService.debug(`[Codex] ${line}`);
					}
				});
			}

			if (this.codexProcess.stderr) {
				const rl = createInterface({
					input: this.codexProcess.stderr,
					crlfDelay: Infinity,
				});

				rl.on('line', (line) => {
					this.logService.warn(`[Codex stderr] ${line}`);
					this.eventEmitter.fire({
						type: 'error',
						data: { message: line },
					});
				});
			}

			// Handle process exit
			this.codexProcess.on('exit', (code, signal) => {
				this.logService.info(`Codex process exited with code ${code}, signal ${signal}`);
				this.codexProcess = null;
				this.eventEmitter.fire({
					type: 'status',
					data: { status: 'stopped', code, signal },
				});
			});

			this.codexProcess.on('error', (error) => {
				this.logService.error('Codex process error:', error);
				this.codexProcess = null;
				this.eventEmitter.fire({
					type: 'error',
					data: { error: error.message },
				});
			});

			return { success: true, message: 'Codex process started' };
		} catch (error) {
			this.logService.error('Failed to start Codex process:', error);
			return { success: false, message: `Failed to start: ${error}` };
		}
	}

	private async _stop(): Promise<{ success: boolean }> {
		if (!this.codexProcess) {
			return { success: true };
		}

		try {
			this.codexProcess.kill();
			this.codexProcess = null;
			return { success: true };
		} catch (error) {
			this.logService.error('Failed to stop Codex process:', error);
			return { success: false };
		}
	}

	private async _submit(params: CodexSubmitParams): Promise<{ success: boolean; requestId?: string }> {
		if (!this.codexProcess || !this.codexProcess.stdin) {
			throw new Error('Codex process not running');
		}

		try {
			// Send JSON-RPC request
			const request = {
				jsonrpc: '2.0',
				method: 'codex/submit',
				params: params,
				id: Date.now(),
			};

			const requestStr = JSON.stringify(request) + '\n';
			this.codexProcess.stdin.write(requestStr);

			return { success: true, requestId: String(request.id) };
		} catch (error) {
			this.logService.error('Failed to submit to Codex:', error);
			throw error;
		}
	}

	private async _nextEvent(params: CodexNextEventParams): Promise<any> {
		if (!this.codexProcess || !this.codexProcess.stdin) {
			throw new Error('Codex process not running');
		}

		// TODO: Implement proper event waiting when codex-rs is integrated
		// For now, return a placeholder
		return { type: 'placeholder', message: 'Codex integration pending' };
	}

	private async _agentStatus(): Promise<CodexAgentStatus> {
		if (!this.codexProcess) {
			return { status: 'stopped' };
		}

		// TODO: Query actual status when codex-rs is integrated
		return { status: 'running' };
	}

	private async _ping(): Promise<{ status: string }> {
		if (!this.codexProcess || !this.codexProcess.stdin) {
			return { status: 'not_running' };
		}

		try {
			const request = {
				jsonrpc: '2.0',
				method: 'codex/ping',
				params: {},
				id: Date.now(),
			};

			const requestStr = JSON.stringify(request) + '\n';
			this.codexProcess.stdin.write(requestStr);

			return { status: 'ok' };
		} catch (error) {
			return { status: 'error' };
		}
	}

	private _getCliPath(): string {
		// Get the path to the CLI binary
		// In development, use cargo run
		// In production, use the bundled binary
		if (this.environmentService.isBuilt) {
			const appPath = process.platform === 'darwin'
				? join(dirname(dirname(process.execPath)), 'Resources', 'app')
				: dirname(process.execPath);
			return join(appPath, 'bin', `code${process.platform === 'win32' ? '.exe' : ''}`);
		} else {
			// Development: use cargo run -- codex
			// Note: This will be handled by spawning cargo with args
			return 'cargo';
		}
	}

	private _getCliArgs(): string[] {
		if (this.environmentService.isBuilt) {
			return ['codex'];
		} else {
			// Development: cargo run -- codex
			return ['run', '--', 'codex'];
		}
	}

	dispose(): void {
		if (this.codexProcess) {
			this.codexProcess.kill();
			this.codexProcess = null;
		}
		this.eventEmitter.dispose();
	}
}
