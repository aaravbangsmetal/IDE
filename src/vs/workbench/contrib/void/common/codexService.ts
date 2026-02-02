/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

export const ICodexService = createDecorator<ICodexService>('codexService');

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
}

/**
 * Service for interacting with the Codex agent engine.
 * Communicates with the Rust CLI process via JSON-RPC.
 */
export interface ICodexService {
	readonly _serviceBrand: undefined;

	/**
	 * Start the Codex agent process.
	 */
	start(): Promise<{ success: boolean; message: string }>;

	/**
	 * Stop the Codex agent process.
	 */
	stop(): Promise<{ success: boolean }>;

	/**
	 * Submit an operation to Codex (e.g., user input, interrupt, etc.).
	 */
	submit(params: CodexSubmitParams): Promise<{ success: boolean; requestId?: string }>;

	/**
	 * Get the next event from Codex.
	 */
	nextEvent(params?: CodexNextEventParams): Promise<any>;

	/**
	 * Get the current agent status.
	 */
	agentStatus(): Promise<CodexAgentStatus>;

	/**
	 * Ping the Codex process to check if it's alive.
	 */
	ping(): Promise<{ status: string }>;

	/**
	 * Event fired when Codex emits an event.
	 */
	readonly onCodexEvent: Event<CodexEvent>;
}

/**
 * Client-side IPC proxy for Codex service.
 */
export class CodexService extends Disposable implements ICodexService {
	readonly _serviceBrand: undefined;

	private readonly _proxy: ICodexService;
	private readonly _onCodexEvent = new Emitter<CodexEvent>();

	readonly onCodexEvent = this._onCodexEvent.event;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		super();

		this._proxy = ProxyChannel.toService<ICodexService>(
			mainProcessService.getChannel('void-channel-codex')
		);

		// Listen for Codex events
		const channel = mainProcessService.getChannel('void-channel-codex');
		this._register((channel.listen<CodexEvent>('onCodexEvent') satisfies Event<CodexEvent>)((event) => {
			this._onCodexEvent.fire(event);
		}));
	}

	async start(): Promise<{ success: boolean; message: string }> {
		return this._proxy.start();
	}

	async stop(): Promise<{ success: boolean }> {
		return this._proxy.stop();
	}

	async submit(params: CodexSubmitParams): Promise<{ success: boolean; requestId?: string }> {
		return this._proxy.submit(params);
	}

	async nextEvent(params?: CodexNextEventParams): Promise<any> {
		return this._proxy.nextEvent(params);
	}

	async agentStatus(): Promise<CodexAgentStatus> {
		return this._proxy.agentStatus();
	}

	async ping(): Promise<{ status: string }> {
		return this._proxy.ping();
	}
}

registerSingleton(ICodexService, CodexService, InstantiationType.Eager);
