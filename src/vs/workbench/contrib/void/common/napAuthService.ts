/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { NapAuthState, NapAuthResponse } from './napAuthTypes.js';

/**
 * Interface for NAP authentication service
 */
export interface INapAuthService {
	readonly _serviceBrand: undefined;

	/**
	 * Initiate OAuth login flow
	 */
	login(): Promise<NapAuthResponse>;

	/**
	 * Logout and clear credentials
	 */
	logout(): Promise<NapAuthResponse>;

	/**
	 * Refresh the access token
	 */
	refreshToken(): Promise<NapAuthResponse>;

	/**
	 * Get current authentication state
	 */
	getAuthState(): Promise<NapAuthState>;

	/**
	 * Get the current access token
	 */
	getAccessToken(): Promise<string | undefined>;

	/**
	 * Check if user is authenticated
	 */
	isAuthenticated(): Promise<boolean>;
}

export const INapAuthService = createDecorator<INapAuthService>('napAuthService');

/**
 * Client-side IPC proxy for NAP authentication service.
 * Communicates with NapAuthMainService via IPC channel.
 */
export class NapAuthService implements INapAuthService {
	readonly _serviceBrand: undefined;

	private readonly _proxy: INapAuthService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxy = ProxyChannel.toService<INapAuthService>(
			mainProcessService.getChannel('void-channel-nap-auth')
		);
	}

	async login(): Promise<NapAuthResponse> {
		return this._proxy.login();
	}

	async logout(): Promise<NapAuthResponse> {
		return this._proxy.logout();
	}

	async refreshToken(): Promise<NapAuthResponse> {
		return this._proxy.refreshToken();
	}

	async getAuthState(): Promise<NapAuthState> {
		return this._proxy.getAuthState();
	}

	async getAccessToken(): Promise<string | undefined> {
		return this._proxy.getAccessToken();
	}

	async isAuthenticated(): Promise<boolean> {
		return this._proxy.isAuthenticated();
	}
}

registerSingleton(INapAuthService, NapAuthService, InstantiationType.Eager);
