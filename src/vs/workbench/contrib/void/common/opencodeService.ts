/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import type { OpencodeSessionInfo, OpencodeEvent, OpencodeConfig, OpencodeToolCall, OpencodePermission } from './opencodeServiceTypes.js';

// Dynamic import types for Opencode SDK
type OpencodeSDKClient = typeof import('@opencode-ai/sdk/client');

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

	private _client: any | undefined; // OpencodeClient loaded dynamically
	private _sdkClientModule: OpencodeSDKClient | undefined;
	private _isConnected: boolean = false;
	private _currentSessionId: string | undefined;
	private _sessions: OpencodeSessionInfo[] = [];
	private _eventStream: AsyncIterable<OpencodeEvent> | undefined;
	private _config: OpencodeConfig = {
		hostname: '127.0.0.1',
		port: 4096,
		baseUrl: 'http://localhost:4096'
	};

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

			// Load SDK client module dynamically
			if (!this._sdkClientModule) {
				try {
					console.log('[Opencode] Loading SDK module...');
					this._sdkClientModule = await importAMDNodeModule<OpencodeSDKClient>('@opencode-ai/sdk', 'dist/client.js');
					console.log('[Opencode] SDK module loaded successfully');
					
					// Verify the module has the expected exports
					if (!this._sdkClientModule || typeof this._sdkClientModule.createOpencodeClient !== 'function') {
						throw new Error('SDK module loaded but createOpencodeClient is not available');
					}
				} catch (loadError) {
					console.error('[Opencode] SDK load error:', loadError);
					throw new Error(`Failed to load Opencode SDK: ${loadError instanceof Error ? loadError.message : String(loadError)}. Make sure @opencode-ai/sdk is installed.`);
				}
			}

			// Connect to existing Opencode server
			// Note: We cannot start the server from browser context, it must be started manually
			const serverUrl = this._config.baseUrl || `http://${this._config.hostname}:${this._config.port}`;
			try {
				console.log(`[Opencode] Connecting to server at ${serverUrl}...`);
				this._client = this._sdkClientModule.createOpencodeClient({
					baseUrl: serverUrl
				});

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

		const session = await this._client.session.create({
			body: { title: title || 'New Session' }
		});

		await this.refreshSessions();
		return session.id;
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
			const result = await this._client.session.get({ path: { id: sessionId } });
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
			const result = await this._client.session.delete({ path: { id: sessionId } });
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

		await this._client.session.prompt({
			path: { id: sessionId },
			body: {
				noReply: options?.noReply ?? false,
				parts: [{ type: 'text', text: enhancedPrompt }]
			}
		});
	}

	async sendCommand(sessionId: string, command: string): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		await this._client.session.command({
			path: { id: sessionId },
			body: { command, arguments: '' }
		});
	}

	async runShell(sessionId: string, command: string): Promise<string> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		const result = await this._client.session.shell({
			path: { id: sessionId },
			body: { command, agent: 'default' }
		});

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

		const result = await this._client.file.read({
			query: { path }
		});

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
			query: {
				query,
				dirs: type === 'directory' ? 'true' : type === 'file' ? 'false' : undefined
			}
		});

		return result.data || [];
	}

	async searchText(pattern: string): Promise<Array<{ path: string; lines: number[] }>> {
		if (!this._client) {
			return [];
		}

		const result = await this._client.find.text({
			query: { pattern }
		});

		return (result.data || []).map((match: any) => ({
			path: match.path?.text || '',
			lines: [match.line_number || 0]
		}));
	}

	async approvePermission(sessionId: string, permissionId: string, approved: boolean): Promise<void> {
		if (!this._client) {
			throw new Error('Not connected to Opencode');
		}

		await this._client.postSessionIdPermissionsPermissionId({
			path: { id: sessionId, permissionID: permissionId },
			body: { response: approved ? 'once' : 'reject' }
		});
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
