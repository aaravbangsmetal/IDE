/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { OpencodeSessionInfo, OpencodeEvent, OpencodeConfig, OpencodeToolCall, OpencodePermission } from './opencodeServiceTypes.js';

// Main process service interface (for IPC)
interface IOpencodeMainService {
	readonly _serviceBrand: undefined;
	startServer(workingDirectory?: string): Promise<{ url: string; port: number }>;
	stopServer(): Promise<void>;
	isServerRunning(): boolean;
	restartWithDirectory(workingDirectory: string): Promise<{ url: string; port: number }>;
}

// Simple HTTP client for Opencode API
interface OpencodeHTTPClient {
	global: {
		health(): Promise<{ healthy: boolean; version?: string }>;
	};
	session: {
		list(): Promise<OpencodeSessionInfo[]>;
		create(body: { title?: string }): Promise<{ id: string; title?: string; createdAt?: number; updatedAt?: number }>;
		get(path: { id: string }): Promise<OpencodeSessionInfo>;
		delete(path: { id: string }): Promise<boolean>;
		prompt(path: { id: string }, body: { parts: Array<{ type: string; text: string }>; noReply?: boolean }): Promise<any>;
		command(path: { id: string }, body: { command: string; arguments: string }): Promise<any>;
		shell(path: { id: string }, body: { command: string; agent: string }): Promise<{ parts?: Array<{ type: string; text?: string }> }>;
		messages(path: { id: string }): Promise<any>;
	};
	postSessionIdPermissionsPermissionId(path: { id: string; permissionID: string }, body: { response: 'once' | 'always' | 'reject' }): Promise<any>;
	event: {
		subscribe(): Promise<{ stream: AsyncIterable<OpencodeEvent> }>;
	};
	file: {
		read(query: { path: string }): Promise<{ type: string; content: string } | null>;
	};
	find: {
		files(query: { query: string; dirs?: string }): Promise<string[]>;
		text(query: { pattern: string }): Promise<Array<{ path: { text: string }; line_number: number }>>;
	};
}

export const IOpencodeService = createDecorator<IOpencodeService>('opencodeService');

export interface IOpencodeService {
	readonly _serviceBrand: undefined;

	// Connection
	readonly isConnected: boolean;
	readonly currentSessionId: string | undefined;
	readonly sessions: OpencodeSessionInfo[];

	// Events
	readonly onDidConnect: Event<void>;
	readonly onDidDisconnect: Event<void>;
	readonly onDidSessionChange: Event<string | undefined>;
	readonly onDidSessionsChange: Event<void>;
	readonly onDidReceiveEvent: Event<OpencodeEvent>;
	readonly onDidToolCall: Event<OpencodeToolCall>;
	readonly onDidPermissionRequest: Event<OpencodePermission>;

	// Methods
	connect(config?: OpencodeConfig): Promise<void>;
	disconnect(): Promise<void>;

	// Session management
	createSession(title?: string): Promise<string>;
	listSessions(): Promise<OpencodeSessionInfo[]>;
	getSession(sessionId: string): Promise<OpencodeSessionInfo | undefined>;
	deleteSession(sessionId: string): Promise<boolean>;
	setCurrentSession(sessionId: string | undefined): void;
	refreshSessions(): Promise<void>;

	// Messaging
	sendPrompt(sessionId: string, prompt: string, options?: { noReply?: boolean }): Promise<string>;
	sendCommand(sessionId: string, command: string): Promise<void>;

	// Tools
	runShell(sessionId: string, command: string): Promise<string>;
	readFile(path: string): Promise<string>;
	searchFiles(query: string, type?: 'file' | 'directory'): Promise<string[]>;
	searchText(pattern: string): Promise<Array<{ path: string; lines: number[] }>>;

	// Permissions
	approvePermission(sessionId: string, permissionId: string, approved: boolean): Promise<void>;

	// Events subscription
	subscribeToEvents(sessionId: string): Promise<void>;

	// Web fetch
	fetchWeb(url: string): Promise<string>;
}

class OpencodeService extends Disposable implements IOpencodeService {
	readonly _serviceBrand: undefined;

	private _isConnected = false;
	private _currentSessionId: string | undefined;
	private _sessions: OpencodeSessionInfo[] = [];
	private _client: OpencodeHTTPClient | null = null;
	private _config: OpencodeConfig = {
		hostname: '127.0.0.1',
		port: 4096
	};
	private _baseUrl: string = 'http://127.0.0.1:4096';
	private _eventSource: EventSource | null = null;

	// IPC proxy to main process
	private readonly _mainService: IOpencodeMainService;

	// Events
	private readonly _onDidConnect = this._register(new Emitter<void>());
	readonly onDidConnect = this._onDidConnect.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect = this._onDidDisconnect.event;

	private readonly _onDidSessionChange = this._register(new Emitter<string | undefined>());
	readonly onDidSessionChange = this._onDidSessionChange.event;

	private readonly _onDidSessionsChange = this._register(new Emitter<void>());
	readonly onDidSessionsChange = this._onDidSessionsChange.event;

	private readonly _onDidReceiveEvent = this._register(new Emitter<OpencodeEvent>());
	readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

	private readonly _onDidToolCall = this._register(new Emitter<OpencodeToolCall>());
	readonly onDidToolCall = this._onDidToolCall.event;

	private readonly _onDidPermissionRequest = this._register(new Emitter<OpencodePermission>());
	readonly onDidPermissionRequest = this._onDidPermissionRequest.event;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();

		// Create IPC proxy to main process service
		this._mainService = ProxyChannel.toService<IOpencodeMainService>(
			mainProcessService.getChannel('void-channel-opencode')
		);

		// Auto-connect when workspace is available
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
			// Workspace changed - reconnect with new directory
			if (this._isConnected) {
				console.log('[Opencode] Workspace changed, reconnecting...');
				this._reconnectWithCurrentWorkspace();
			}
		}));

		// Initial connection attempt after a small delay
		setTimeout(() => {
			this._autoConnect();
		}, 1000);
	}

	private async _autoConnect(): Promise<void> {
		try {
			await this.connect();
		} catch (err) {
			console.log('[Opencode] Auto-connect failed (will retry on first use):', err);
		}
	}

	private async _reconnectWithCurrentWorkspace(): Promise<void> {
		try {
			await this.disconnect();
			await this.connect();
		} catch (err) {
			console.error('[Opencode] Reconnect failed:', err);
		}
	}

	get isConnected(): boolean {
		return this._isConnected;
	}

	get currentSessionId(): string | undefined {
		return this._currentSessionId;
	}

	get sessions(): OpencodeSessionInfo[] {
		return [...this._sessions];
	}

	// Create HTTP client wrapper
	private _createHTTPClient(baseUrl: string): OpencodeHTTPClient {
		const apiCall = async (method: string, stringPath: string, body?: any): Promise<any> => {
			const url = `${baseUrl}${stringPath}`;
			const options: RequestInit = {
				method,
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				mode: 'cors',
				credentials: 'omit'
			};
			if (body) {
				options.body = JSON.stringify(body);
			}
			const response = await fetch(url, options);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			const text = await response.text();
			if (!text) return null;
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		};

		return {
			global: {
				health: () => apiCall('GET', '/global/health')
			},
			session: {
				list: () => apiCall('GET', '/session'),
				create: (body) => apiCall('POST', '/session', body),
				get: (path) => apiCall('GET', `/session/${path.id}`),
				delete: (path) => apiCall('DELETE', `/session/${path.id}`),
				prompt: (path, body) => apiCall('POST', `/session/${path.id}/message`, body),
				command: (path, body) => apiCall('POST', `/session/${path.id}/command`, body),
				shell: (path, body) => apiCall('POST', `/session/${path.id}/shell`, body),
				messages: (path) => apiCall('GET', `/session/${path.id}/message`)
			},
			postSessionIdPermissionsPermissionId: (path, body) => apiCall('POST', `/session/${path.id}/permissions/${path.permissionID}`, body),
			event: {
				subscribe: async () => {
					const url = `${baseUrl}/global/event`;
					console.log(`[Opencode] Subscribing to SSE at ${url}`);
					const eventSource = new EventSource(url);
					this._eventSource = eventSource;

					const stream: AsyncIterable<OpencodeEvent> = {
						async *[Symbol.asyncIterator]() {
							const events: OpencodeEvent[] = [];
							let resolve: ((value: OpencodeEvent) => void) | null = null;
							let reject: ((error: any) => void) | null = null;

							eventSource.onmessage = (e) => {
								try {
									const event = JSON.parse(e.data) as OpencodeEvent;
									console.log('[Opencode] SSE event:', event.type);
									if (resolve) {
										resolve(event);
										resolve = null;
									} else {
										events.push(event);
									}
								} catch (err) {
									console.error('[Opencode] SSE parse error:', err);
								}
							};

							eventSource.onerror = (err) => {
								console.error('[Opencode] SSE error:', err);
								if (reject) {
									reject(err);
									reject = null;
								}
							};

							while (true) {
								if (events.length > 0) {
									yield events.shift()!;
								} else {
									yield new Promise<OpencodeEvent>((res, rej) => {
										resolve = res;
										reject = rej;
									});
								}
							}
						}
					};
					return { stream };
				}
			},
			file: {
				read: (query) => apiCall('GET', `/file/content?path=${encodeURIComponent(query.path)}`)
			},
			find: {
				files: (query) => apiCall('GET', `/find/file?query=${encodeURIComponent(query.query)}${query.dirs ? `&dirs=${query.dirs}` : ''}`),
				text: (query) => apiCall('GET', `/find/text?pattern=${encodeURIComponent(query.pattern)}`)
			}
		};
	}

	async connect(config?: OpencodeConfig): Promise<void> {
		if (this._isConnected) {
			return;
		}

		try {
			if (config) {
				this._config = { ...this._config, ...config };
			}

			// Get workspace directory
			const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
			const workspaceDir = config?.workspaceDir || workspaceFolders[0]?.uri.fsPath;

			console.log(`[Opencode] Connecting with workspace: ${workspaceDir || 'none'}`);

			// Tell main process to start server with this workspace directory
			// This is the DEEP INTEGRATION - main process manages the server
			try {
				const result = await this._mainService.restartWithDirectory(workspaceDir || process.cwd?.() || '/tmp');
				console.log(`[Opencode] Main process started server at ${result.url}`);
				this._baseUrl = result.url;
			} catch (err) {
				console.log('[Opencode] Main process server start failed, trying existing server:', err);
				// Fallback to connecting to existing server
				this._baseUrl = this._config.baseUrl || `http://${this._config.hostname}:${this._config.port}`;
			}

			// Create HTTP client
			this._client = this._createHTTPClient(this._baseUrl);

			// Test connection
			console.log(`[Opencode] Testing connection to ${this._baseUrl}...`);
			const health = await this._client.global.health();
			console.log('[Opencode] Health:', JSON.stringify(health));

			if (health?.healthy) {
				this._isConnected = true;
				await this.refreshSessions();
				this._onDidConnect.fire();
				console.log(`[Opencode] Connected successfully to ${this._baseUrl}`);
				return;
			} else {
				throw new Error('Server health check returned unhealthy');
			}
		} catch (err) {
			console.error('[Opencode] Connection error:', err);
			throw new Error(`Failed to connect to Opencode: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async disconnect(): Promise<void> {
		if (this._eventSource) {
			this._eventSource.close();
			this._eventSource = null;
		}
		this._client = null;
		this._isConnected = false;
		this._currentSessionId = undefined;
		this._sessions = [];
		this._onDidDisconnect.fire();
	}

	async refreshSessions(): Promise<void> {
		if (!this._client) return;
		try {
			const sessions = await this._client.session.list();
			this._sessions = Array.isArray(sessions) ? sessions : [];
			this._onDidSessionsChange.fire();
		} catch (err) {
			console.error('[Opencode] Failed to refresh sessions:', err);
		}
	}

	async createSession(title?: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const result = await this._client.session.create({ title });
		const sessionId = result.id;
		await this.refreshSessions();
		return sessionId;
	}

	async listSessions(): Promise<OpencodeSessionInfo[]> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const sessions = await this._client.session.list();
		this._sessions = Array.isArray(sessions) ? sessions : [];
		this._onDidSessionsChange.fire();
		return this._sessions;
	}

	async getSession(sessionId: string): Promise<OpencodeSessionInfo | undefined> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		try {
			return await this._client.session.get({ id: sessionId });
		} catch {
			return undefined;
		}
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const result = await this._client.session.delete({ id: sessionId });
		await this.refreshSessions();
		return result;
	}

	setCurrentSession(sessionId: string | undefined): void {
		this._currentSessionId = sessionId;
		this._onDidSessionChange.fire(sessionId);
	}

	async sendPrompt(sessionId: string, prompt: string, options?: { noReply?: boolean }): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		// Enhance prompt for web search if needed
		let enhancedPrompt = prompt;
		const lowerPrompt = prompt.toLowerCase();
		if ((lowerPrompt.includes('search') || lowerPrompt.includes('look up') || lowerPrompt.includes('find'))
			&& (lowerPrompt.includes('web') || lowerPrompt.includes('internet') || lowerPrompt.includes('online'))) {
			enhancedPrompt = `${prompt}\n\nNote: Use the webfetch tool to search the web.`;
		}

		// Fire thinking event
		this._onDidReceiveEvent.fire({
			type: 'message.streaming',
			properties: { text: '', thinking: true }
		});

		const url = `${this._baseUrl}/session/${sessionId}/message`;
		console.log(`[Opencode] POST ${url}`);

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			mode: 'cors',
			credentials: 'omit',
			body: JSON.stringify({
				noReply: options?.noReply ?? false,
				parts: [{ type: 'text', text: enhancedPrompt }]
			})
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const text = await response.text();
		console.log('[Opencode] Response:', text.substring(0, 300));

		// Parse response
		let resultText = '';
		try {
			const parsed = JSON.parse(text);
			if (parsed?.parts) {
				resultText = parsed.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text || '').join('\n');
			} else if (parsed?.info?.parts) {
				resultText = parsed.info.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text || '').join('\n');
			} else if (parsed?.content) {
				resultText = parsed.content;
			} else if (Array.isArray(parsed)) {
				resultText = parsed.filter((p: any) => p.type === 'text').map((p: any) => p.text || '').join('\n');
			}
		} catch {
			resultText = text;
		}

		// Fire completion event
		this._onDidReceiveEvent.fire({
			type: 'message.completed',
			properties: { text: resultText }
		});

		return resultText;
	}

	async sendCommand(sessionId: string, command: string): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		await this._client.session.command({ id: sessionId }, { command, arguments: '' });
	}

	async runShell(sessionId: string, command: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const result = await this._client.session.shell({ id: sessionId }, { command, agent: 'shell' });
		if (result?.parts) {
			const textParts = result.parts.filter(p => p.type === 'text');
			return textParts.map(p => p.text || '').join('\n');
		}
		return '';
	}

	async readFile(path: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const result = await this._client.file.read({ path });
		return result?.content || '';
	}

	async searchFiles(query: string, type?: 'file' | 'directory'): Promise<string[]> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const dirs = type === 'directory' ? 'true' : type === 'file' ? 'false' : undefined;
		const result = await this._client.find.files({ query, dirs });
		return Array.isArray(result) ? result : [];
	}

	async searchText(pattern: string): Promise<Array<{ path: string; lines: number[] }>> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		const result = await this._client.find.text({ pattern });
		if (!Array.isArray(result)) return [];
		const grouped = new Map<string, number[]>();
		for (const match of result) {
			const path = match?.path?.text || '';
			if (!grouped.has(path)) {
				grouped.set(path, []);
			}
			grouped.get(path)!.push(match.line_number);
		}
		return Array.from(grouped.entries()).map(([path, lines]) => ({ path, lines }));
	}

	async approvePermission(sessionId: string, permissionId: string, approved: boolean): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		await this._client.postSessionIdPermissionsPermissionId(
			{ id: sessionId, permissionID: permissionId },
			{ response: approved ? 'once' : 'reject' }
		);
	}

	async subscribeToEvents(sessionId: string): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		try {
			const { stream } = await this._client.event.subscribe();

			// Process events in background
			(async () => {
				try {
					for await (const event of stream) {
						this._onDidReceiveEvent.fire(event);

						// Handle specific event types
						if (event.type === 'tool.call' || event.type === 'tool.used') {
							this._onDidToolCall.fire({
								name: event.properties?.tool || event.properties?.name || 'unknown',
								params: event.properties?.params || {},
								status: 'running'
							});
						} else if (event.type === 'permission.required') {
							this._onDidPermissionRequest.fire({
								id: event.properties?.id || '',
								type: event.properties?.type || 'edits',
								action: event.properties?.action || '',
								approved: null
							});
						}
					}
				} catch (err) {
					console.error('[Opencode] Event stream error:', err);
				}
			})();
		} catch (err) {
			console.error('[Opencode] Failed to subscribe to events:', err);
		}
	}

	async fetchWeb(url: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		// Use the shell command to fetch URL
		const result = await this.runShell(this._currentSessionId || '', `curl -s "${url}"`);
		return result;
	}
}

registerSingleton(IOpencodeService, OpencodeService, InstantiationType.Eager);
