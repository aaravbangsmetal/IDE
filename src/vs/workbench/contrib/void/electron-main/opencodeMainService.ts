/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

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
		// Auto-start server when service is created
		this.startServer().catch(err => {
			console.error('[Opencode] Failed to auto-start server:', err);
		});
	}

	async startServer(): Promise<{ url: string; port: number }> {
		if (this._serverProcess) {
			return { url: this._serverUrl || `http://localhost:${this._serverPort}`, port: this._serverPort };
		}

		try {
			// Find opencode command
			const opencodePath = this._findOpencodeCommand();
			if (!opencodePath) {
				throw new Error('Opencode command not found. Please install it: npm install -g @opencode-ai/cli');
			}

			console.log('[Opencode] Starting server...');

			// Start the server
			this._serverProcess = spawn(opencodePath, ['serve', '--hostname', '127.0.0.1', '--port', String(this._serverPort)], {
				detached: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					// Pass config via environment variable if needed
				}
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

		for (const path of possiblePaths) {
			if (existsSync(path)) {
				return path;
			}
		}

		// Try to find in PATH
		try {
			const { execSync } = require('child_process');
			const whichResult = execSync('which opencode', { encoding: 'utf-8' }).trim();
			if (whichResult && existsSync(whichResult)) {
				return whichResult;
			}
		} catch {
			// which command failed
		}

		return undefined;
	}

	private async _checkServerHealth(url: string): Promise<boolean> {
		try {
			const http = require('http');
			return new Promise((resolve) => {
				const req = http.get(`${url}/health`, { timeout: 2000 }, (res: any) => {
					resolve(res.statusCode === 200);
				});
				req.on('error', () => resolve(false));
				req.on('timeout', () => {
					req.destroy();
					resolve(false);
				});
			});
		} catch {
			return false;
		}
	}
}
