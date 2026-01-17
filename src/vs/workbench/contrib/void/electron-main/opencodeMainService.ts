/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { spawn, ChildProcess, execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import * as http from 'http';
import * as url from 'url';

export const IOpencodeMainService = createDecorator<IOpencodeMainService>('opencodeMainService');

export interface IOpencodeMainService {
	readonly _serviceBrand: undefined;
	startServer(): Promise<{ url: string; port: number }>;
	stopServer(): Promise<void>;
	isServerRunning(): boolean;
}

export class OpencodeMainService extends Disposable implements IOpencodeMainService {
	readonly _serviceBrand: undefined;

	private _serverProcess: ChildProcess | undefined;
	private _serverUrl: string | undefined;
	private _serverPort: number = 4096;

	constructor() {
		super();
		// Auto-start server when service is created (don't block)
		// Use setTimeout to avoid blocking service registration
		setTimeout(() => {
			this.startServer().catch(err => {
				console.error('[Opencode] Failed to auto-start server:', err);
				// Log to stderr so it appears in main process logs
				process.stderr.write(`[Opencode] Failed to auto-start server: ${err instanceof Error ? err.message : String(err)}\n`);
			});
		}, 500); // Small delay to let app initialize
	}

	async startServer(): Promise<{ url: string; port: number }> {
		if (this._serverProcess) {
			return { url: this._serverUrl || `http://localhost:${this._serverPort}`, port: this._serverPort };
		}

		try {
			// Kill any existing opencode server on this port
			await this._killExistingServer();

			// Find opencode command
			const opencodePath = this._findOpencodeCommand();
			if (!opencodePath) {
				const errorMsg = 'Opencode command not found. Please install it from https://opencode.ai';
				console.error(`[Opencode] ${errorMsg}`);
				process.stderr.write(`[Opencode] ${errorMsg}\n`);
				throw new Error(errorMsg);
			}

			console.log(`[Opencode] Starting API server with: ${opencodePath} serve`);
			process.stdout.write(`[Opencode] Starting API server (not web UI) with: ${opencodePath}\n`);

			// Start the API server with 'serve' command (not 'web' which gives HTML UI)
			// 'opencode serve' exposes JSON API at /global/health, /session, etc.
			// 'opencode web' is the web UI which returns HTML (wrong for API access)
			const args = [
				'serve',  // API server mode (JSON endpoints)
				'--hostname', '127.0.0.1',  // Listen on localhost
				'--port', String(this._serverPort),
				'--cors', '*'  // Allow all origins for browser access
			];

			console.log(`[Opencode] Command: ${opencodePath} ${args.join(' ')}`);

			this._serverProcess = spawn(opencodePath, args, {
				detached: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
				},
				cwd: process.cwd() // Use current working directory for config
			});

			this._serverProcess.stdout?.on('data', (data: Buffer) => {
				const output = data.toString();
				console.log('[Opencode]', output);

				// Parse server URL from output
				const urlMatch = output.match(/opencode server listening on (https?:\/\/[^\s]+)/);
				if (urlMatch) {
					this._serverUrl = urlMatch[1];
				}
			});

			this._serverProcess.stderr?.on('data', (data: Buffer) => {
				const output = data.toString();
				console.error('[Opencode]', output);
			});

			this._serverProcess.on('exit', (code, signal) => {
				console.log(`[Opencode] Server exited with code ${code}, signal ${signal}`);
				this._serverProcess = undefined;
				this._serverUrl = undefined;
			});

			this._serverProcess.on('error', (error) => {
				console.error('[Opencode] Server error:', error);
				this._serverProcess = undefined;
				this._serverUrl = undefined;
			});

			// Wait a bit for server to start
			await new Promise(resolve => setTimeout(resolve, 2000));

			// Verify server is running
			const url = this._serverUrl || `http://localhost:${this._serverPort}`;
			const isRunning = await this._checkServerHealth(url);

			if (!isRunning) {
				throw new Error('Server started but health check failed');
			}

			console.log(`[Opencode] Server started at ${url}`);
			return { url, port: this._serverPort };
		} catch (error) {
			this._serverProcess = undefined;
			throw error;
		}
	}

	async stopServer(): Promise<void> {
		if (this._serverProcess) {
			console.log('[Opencode] Stopping server...');
			this._serverProcess.kill();
			this._serverProcess = undefined;
			this._serverUrl = undefined;
		}
	}

	private async _killExistingServer(): Promise<void> {
		try {
			// Kill any existing opencode process on the port
			execSync(`lsof -ti :${this._serverPort} | xargs kill -9 2>/dev/null || true`, { encoding: 'utf-8' });
			// Also kill any opencode serve/web processes
			execSync(`pkill -f "opencode (serve|web)" 2>/dev/null || true`, { encoding: 'utf-8' });
			// Wait a bit for processes to die
			await new Promise(resolve => setTimeout(resolve, 500));
		} catch {
			// Ignore errors - process might not exist
		}
	}

	isServerRunning(): boolean {
		return !!this._serverProcess && this._serverProcess.exitCode === null;
	}

	private _findOpencodeCommand(): string | undefined {
		// Check common locations
		const possiblePaths = [
			'/Users/bunny/.opencode/bin/opencode', // User's local install
			join(process.env.HOME || '', '.opencode', 'bin', 'opencode'),
			join(process.env.HOME || '', '.local', 'bin', 'opencode'),
			'/usr/local/bin/opencode',
			'/opt/homebrew/bin/opencode',
		];

		for (const p of possiblePaths) {
			if (existsSync(p)) {
				return p;
			}
		}

		// Try to find in PATH
		try {
			const whichResult = execSync('which opencode', { encoding: 'utf-8' }).trim();
			if (whichResult && existsSync(whichResult)) {
				return whichResult;
			}
		} catch {
			// which command failed
		}

		return undefined;
	}

	private async _checkServerHealth(serverUrl: string): Promise<boolean> {
		try {
			// API endpoint is /global/health for opencode serve
			return new Promise((resolve) => {
				const req = http.get(`${serverUrl}/global/health`, { timeout: 3000 }, (res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => {
						data += chunk.toString();
					});
					res.on('end', () => {
						// Check if response is JSON (API) not HTML (web UI)
						if (data.includes('<!doctype') || data.includes('<html')) {
							console.log('[Opencode] Server returned HTML - wrong mode (web UI instead of API)');
							resolve(false);
							return;
						}
						try {
							const json = JSON.parse(data);
							resolve(json.healthy === true || res.statusCode === 200);
						} catch {
							// If not JSON, might be wrong server
							console.log('[Opencode] Server response is not JSON:', data.substring(0, 100));
							resolve(false);
						}
					});
				});
				req.on('error', (err: Error) => {
					console.log('[Opencode] Health check error:', err.message);
					resolve(false);
				});
				req.on('timeout', () => {
					console.log('[Opencode] Health check timeout');
					req.destroy();
					resolve(false);
				});
			});
		} catch (err) {
			console.log('[Opencode] Health check exception:', err);
			return false;
		}
	}

	async proxyRequest(method: string, requestPath: string, body?: any): Promise<any> {
		const serverUrl = this._serverUrl || `http://127.0.0.1:${this._serverPort}`;
		const fullUrl = `${serverUrl}${requestPath}`;

		return new Promise((resolve, reject) => {
			const urlObj = url.parse(fullUrl);

			const options = {
				hostname: urlObj.hostname,
				port: urlObj.port || this._serverPort,
				path: urlObj.path,
				method: method,
				headers: {
					'Content-Type': 'application/json',
				}
			};

			const req = http.request(options, (res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => {
					data += chunk.toString();
				});
				res.on('end', () => {
					try {
						const json = JSON.parse(data);
						resolve(json);
					} catch {
						resolve(data);
					}
				});
			});

			req.on('error', (err: Error) => {
				reject(err);
			});

			if (body) {
				req.write(JSON.stringify(body));
			}
			req.end();
		});
	}
}
