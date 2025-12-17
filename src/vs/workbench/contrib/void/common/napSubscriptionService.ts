/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { NapSubscriptionResponse } from './napSubscriptionTypes.js';

/**
 * Interface for NAP subscription service
 */
export interface INapSubscriptionService {
	readonly _serviceBrand: undefined;

	/**
	 * Get subscription status
	 */
	getSubscription(forceRefresh?: boolean): Promise<NapSubscriptionResponse>;

	/**
	 * Force refresh subscription from server
	 */
	refreshSubscription(): Promise<NapSubscriptionResponse>;

	/**
	 * Check if subscription is active
	 */
	isSubscriptionActive(): Promise<boolean>;

	/**
	 * Get usage limits from subscription
	 */
	getUsageLimits(): Promise<{ tokens: number; requests: number; devices: number } | null>;

	/**
	 * Get current usage from subscription
	 */
	getCurrentUsage(): Promise<{ tokens: number; requests: number } | null>;
}

export const INapSubscriptionService = createDecorator<INapSubscriptionService>('napSubscriptionService');

/**
 * Client-side IPC proxy for NAP subscription service.
 */
export class NapSubscriptionService implements INapSubscriptionService {
	readonly _serviceBrand: undefined;

	private readonly _proxy: INapSubscriptionService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxy = ProxyChannel.toService<INapSubscriptionService>(
			mainProcessService.getChannel('void-channel-nap-subscription')
		);
	}

	async getSubscription(forceRefresh?: boolean): Promise<NapSubscriptionResponse> {
		return this._proxy.getSubscription(forceRefresh);
	}

	async refreshSubscription(): Promise<NapSubscriptionResponse> {
		return this._proxy.refreshSubscription();
	}

	async isSubscriptionActive(): Promise<boolean> {
		return this._proxy.isSubscriptionActive();
	}

	async getUsageLimits(): Promise<{ tokens: number; requests: number; devices: number } | null> {
		return this._proxy.getUsageLimits();
	}

	async getCurrentUsage(): Promise<{ tokens: number; requests: number } | null> {
		return this._proxy.getCurrentUsage();
	}
}

registerSingleton(INapSubscriptionService, NapSubscriptionService, InstantiationType.Eager);
