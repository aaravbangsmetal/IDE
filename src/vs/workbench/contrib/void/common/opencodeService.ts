/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import type { OpencodeSessionInfo, OpencodeEvent, OpencodeConfig, OpencodeToolCall, OpencodePermission } from './opencodeServiceTypes.js';

// Simple HTTP client for Opencode API (using fetch directly since SDK is ES modules)
interface OpencodeHTTPClient {
	global: {
		health(): Promise<{ data: { healthy: boolean; version?: string } }>;
	};
	session: {
		list(): Promise<{ data: OpencodeSessionInfo[] }>;
		create(body: { title?: string }): Promise<{ data: { id: string; title?: string; createdAt?: number; updatedAt?: number } }>;
		get(path: { id: string }): Promise<{ data: OpencodeSessionInfo }>;
		delete(path: { id: string }): Promise<{ data: boolean }>;
		prompt(path: { id: string }, body: { parts: Array<{ type: string; text: string }>; noReply?: boolean }): Promise<any>;
		command(path: { id: string }, body: { command: string; arguments: string }): Promise<any>;
		shell(path: { id: string }, body: { command: string; agent: string }): Promise<{ data?: { parts?: Array<{ type: string; text?: string }> } }>;
		messages(path: { id: string }): Promise<any>;
	};
	postSessionIdPermissionsPermissionId(path: { id: string; permissionID: string }, body: { response: 'once' | 'always' | 'reject' }): Promise<any>;
	event: {
		subscribe(): Promise<{ stream: AsyncIterable<OpencodeEvent> }>;
	};
	file: {
		read(query: { path: string }): Promise<{ data?: { type: string; content: string } }>;
	};
	find: {
		files(query: { query: string; dirs?: string }): Promise<{ data: string[] }>;
		text(query: { pattern: string }): Promise<{ data: Array<{ path: { text: string }; line_number: number }> }>;
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

	// Connection methods
	connect(config?: OpencodeConfig): Promise<void>;
	disconnect(): Promise<void>;

	// Session methods
	createSession(title?: string): Promise<string>;
	listSessions(): Promise<OpencodeSessionInfo[]>;
	getSession(sessionId: string): Promise<OpencodeSessionInfo | undefined>;
	deleteSession(sessionId: string): Promise<boolean>;
	setCurrentSession(sessionId: string | undefined): void;

	// Prompt methods
	sendPrompt(sessionId: string, prompt: string, options?: { noReply?: boolean }): Promise<void>;
	sendCommand(sessionId: string, command: string): Promise<void>;
	runShell(sessionId: string, command: string): Promise<string>;

	// File operations
	readFile(path: string): Promise<string>;
	searchFiles(query: string, type?: 'file' | 'directory'): Promise<string[]>;
	searchText(pattern: string): Promise<Array<{ path: string; lines: number[] }>>;

	// Web operations
	fetchWeb(url: string): Promise<string>;

	// Permission handling
	approvePermission(sessionId: string, permissionId: string, approved: boolean): Promise<void>;

	// Event subscription
	subscribeToEvents(sessionId: string): Promise<void>;
}

class OpencodeService extends Disposable implements IOpencodeService {
	declare readonly _serviceBrand: undefined;

	private _client: OpencodeHTTPClient | undefined;
	private _baseUrl: string = 'http://localhost:4096';
	private _isConnected: boolean = false;
	private _currentSessionId: string | undefined;
	private _sessions: OpencodeSessionInfo[] = [];
	private _eventStream: AsyncIterable<OpencodeEvent> | undefined;
	private _config: OpencodeConfig = {
		hostname: '127.0.0.1',
		port: 4096,
		baseUrl: 'http://localhost:4096'
	};

	// Create HTTP client wrapper using direct fetch
	// Server is started with --cors flag to allow browser access
	private _createHTTPClient(baseUrl: string): OpencodeHTTPClient {
		const apiCall = async (method: string, path: string, body?: any): Promise<any> => {
			const url = `${baseUrl}${path}`;
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
			return response.json();
		};

		return {
			global: {
				health: () => apiCall('GET', '/health')
			},
			session: {
				list: () => apiCall('GET', '/session'),
				create: (body) => apiCall('POST', '/session', body),
				get: (path) => apiCall('GET', `/session/${path.id}`),
				delete: (path) => apiCall('DELETE', `/session/${path.id}`),
				prompt: (path, body) => apiCall('POST', `/session/${path.id}/prompt`, body),
				command: (path, body) => apiCall('POST', `/session/${path.id}/command`, body),
				shell: (path, body) => apiCall('POST', `/session/${path.id}/shell`, body),
				messages: (path) => apiCall('GET', `/session/${path.id}/message`)
			},
			postSessionIdPermissionsPermissionId: (path, body) => apiCall('POST', `/session/${path.id}/permissions/${path.permissionID}`, body),
			event: {
				subscribe: async () => {
					// SSE subscription
					const url = `${baseUrl}/event`;
					const eventSource = new EventSource(url);
					const stream: AsyncIterable<OpencodeEvent> = {
						async *[Symbol.asyncIterator]() {
							const events: OpencodeEvent[] = [];
							let resolve: ((value: OpencodeEvent) => void) | null = null;
							let reject: ((error: any) => void) | null = null;

							eventSource.onmessage = (e) => {
								try {
									const event = JSON.parse(e.data) as OpencodeEvent;
									if (resolve) {
										resolve(event);
										resolve = null;
									} else {
										events.push(event);
									}
								} catch (err) {
									if (reject) {
										reject(err);
										reject = null;
									}
								}
							};

							eventSource.onerror = (err) => {
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

	constructor() {
		super();
	}

	get isConnected(): boolean {
		return this._isConnected && !!this._client;
	}

	get currentSessionId(): string | undefined {
		return this._currentSessionId;
	}

	get sessions(): OpencodeSessionInfo[] {
		return this._sessions;
	}

	async connect(config?: OpencodeConfig): Promise<void> {
		if (this._isConnected) {
			return;
		}

		try {
			if (config) {
				this._config = { ...this._config, ...config };
			}

			// Connect to existing Opencode server using HTTP client
			// Note: We cannot start the server from browser context, it must be started manually
			const serverUrl = this._config.baseUrl || `http://${this._config.hostname}:${this._config.port}`;
			this._baseUrl = serverUrl;

			try {
				console.log(`[Opencode] Connecting to server at ${serverUrl}...`);
				this._client = this._createHTTPClient(serverUrl);

				// Test connection
				console.log('[Opencode] Testing connection...');
				const health = await this._client.global.health();
				if (health.data?.healthy) {
					this._isConnected = true;
					await this.refreshSessions();
					this._onDidConnect.fire();
					console.log(`[Opencode] Connected successfully to ${serverUrl}`);
					return;
				} else {
					throw new Error('Server health check returned unhealthy');
				}
			} catch (err) {
				console.error('[Opencode] Connection error:', err);
				const errorMessage = err instanceof Error ? err.message : String(err);

				// Check if it's a network error (server not running)
				if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Failed to fetch')) {
					throw new Error(`Cannot connect to Opencode server at ${serverUrl}. The server is not running. Please start it with: opencode serve`);
				}

				throw new Error(`Failed to connect to Opencode server at ${serverUrl}: ${errorMessage}. Make sure the Opencode server is running. Start it with: opencode serve`);
			}
		} catch (error) {
			this._isConnected = false;
			throw new Error(`Failed to connect to Opencode: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async disconnect(): Promise<void> {
		if (this._eventStream) {
			// Close event stream if needed
			this._eventStream = undefined;
		}
		this._client = undefined;
		this._isConnected = false;
		this._onDidDisconnect.fire();
	}

	async createSession(title?: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		const result = await this._client.session.create({
			title: title || 'New Session'
		});

		await this.refreshSessions();
		return result.data.id;
	}

	async listSessions(): Promise<OpencodeSessionInfo[]> {
		if (!this._client) {
			return [];
		}

		const sessions = await this._client.session.list();
		return sessions.data.map((s: any) => ({
			id: s.id,
			title: s.title || 'Untitled',
			createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
			updatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now(),
			isActive: s.id === this._currentSessionId
		}));
	}

	async getSession(sessionId: string): Promise<OpencodeSessionInfo | undefined> {
		if (!this._client) {
			return undefined;
		}

		try {
			const result = await this._client.session.get({ id: sessionId });
			if (!result.data) {
				return undefined;
			}
			const session = result.data;
			return {
				id: session.id,
				title: session.title || 'Untitled',
				createdAt: session.createdAt ? new Date(session.createdAt).getTime() : Date.now(),
				updatedAt: session.updatedAt ? new Date(session.updatedAt).getTime() : Date.now(),
				isActive: session.id === this._currentSessionId
			};
		} catch {
			return undefined;
		}
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		if (!this._client) {
			return false;
		}

		try {
			const result = await this._client.session.delete({ id: sessionId });
			if (result.data) {
				await this.refreshSessions();
				if (this._currentSessionId === sessionId) {
					this.setCurrentSession(undefined);
				}
			}
			return result.data || false;
		} catch {
			return false;
		}
	}

	setCurrentSession(sessionId: string | undefined): void {
		if (this._currentSessionId !== sessionId) {
			this._currentSessionId = sessionId;
			this._onDidSessionChange.fire(sessionId);
			this.refreshSessions();
		}
	}

	async sendPrompt(sessionId: string, prompt: string, options?: { noReply?: boolean }): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		// Enhance prompt to explicitly mention web search capability if user asks about web
		let enhancedPrompt = prompt;
		const lowerPrompt = prompt.toLowerCase();
		if ((lowerPrompt.includes('search the web') || lowerPrompt.includes('search web') || lowerPrompt.includes('look up') || lowerPrompt.includes('find information'))
			&& !lowerPrompt.includes('webfetch') && !lowerPrompt.includes('use webfetch')) {
			// Add hint that webfetch tool is available
			enhancedPrompt = `${prompt}\n\nNote: You have access to the webfetch tool to search the web and fetch web pages. Use it when you need current information from the internet.`;
		}

		await this._client.session.prompt(
			{ id: sessionId },
			{
				noReply: options?.noReply ?? false,
				parts: [{ type: 'text', text: enhancedPrompt }]
			}
		);
	}

	async sendCommand(sessionId: string, command: string): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		await this._client.session.command(
			{ id: sessionId },
			{ command, arguments: '' }
		);
	}

	async runShell(sessionId: string, command: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		const result = await this._client.session.shell(
			{ id: sessionId },
			{ command, agent: 'default' }
		);

		// Shell returns AssistantMessage, extract text from parts
		if (result.data?.parts) {
			const textPart = result.data.parts.find((p: any) => p.type === 'text');
			return textPart?.text || '';
		}
		return '';
	}

	async readFile(path: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		const result = await this._client.file.read({ path });

		if (!result.data) {
			return '';
		}

		// FileContent has type "text" and content string
		if (result.data.type === 'text') {
			return result.data.content || '';
		}
		return '';
	}

	async searchFiles(query: string, type?: 'file' | 'directory'): Promise<string[]> {
		if (!this._client) {
			return [];
		}

		const result = await this._client.find.files({
			query,
			dirs: type === 'directory' ? 'true' : type === 'file' ? 'false' : undefined
		});

		return result.data || [];
	}

	async searchText(pattern: string): Promise<Array<{ path: string; lines: number[] }>> {
		if (!this._client) {
			return [];
		}

		const result = await this._client.find.text({ pattern });

		return (result.data || []).map((match: any) => ({
			path: match.path?.text || '',
			lines: [match.line_number || 0]
		}));
	}

	async fetchWeb(url: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}
		// This would use the webfetch tool via a session command
		// For now, just return empty - this can be implemented later
		return '';
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
			const events = await this._client.event.subscribe();
			this._eventStream = events.stream as any;

			// Process events asynchronously
			(async () => {
				for await (const event of events.stream) {
					const eventType = event.type as string;
					const eventProps = (event as any).properties || {};

					this._onDidReceiveEvent.fire({
						type: eventType,
						properties: eventProps
					});

					// Handle specific event types
					if (eventType === 'file.edited' || eventType === 'command.executed') {
						// Tool was used (file edit or command execution)
						this._onDidToolCall.fire({
							name: eventType === 'file.edited' ? 'edit' : 'command',
							params: eventProps,
							status: 'completed'
						});
					} else if (eventType === 'permission.updated' || eventType === 'permission.replied') {
						// Permission event
						const permission = eventProps.permission || {};
						this._onDidPermissionRequest.fire({
							id: permission.id || permission.permissionID || '',
							type: permission.type || 'edits',
							action: permission.action || '',
							approved: eventType === 'permission.replied' ? (eventProps.response === 'once' || eventProps.response === 'always') : null
						});
					}
				}
			})().catch(err => {
				console.error('Error processing Opencode events:', err);
			});
		} catch (error) {
			console.error('Failed to subscribe to Opencode events:', error);
		}
	}

	private async refreshSessions(): Promise<void> {
		this._sessions = await this.listSessions();
		this._onDidSessionsChange.fire();
	}
}

registerSingleton(IOpencodeService, OpencodeService, InstantiationType.Delayed);
