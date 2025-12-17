/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { NapUsageReport, NapUsageResponse } from './napUsageTypes.js';

/**
 * Interface for NAP usage tracking service
 */
export interface INapUsageService {
	readonly _serviceBrand: undefined;

	/**
	 * Track tokens used for an AI feature
	 */
	trackUsage(tokens: number): Promise<NapUsageResponse>;

	/**
	 * Report detailed usage with metadata
	 */
	reportUsage(report: NapUsageReport): Promise<NapUsageResponse>;

	/**
	 * Get pending (unsynced) report count
	 */
	getPendingCount(): Promise<number>;

	/**
	 * Force sync all pending reports
	 */
	forceSync(): Promise<void>;
}

export const INapUsageService = createDecorator<INapUsageService>('napUsageService');

/**
 * Client-side IPC proxy for NAP usage service.
 */
export class NapUsageService implements INapUsageService {
	readonly _serviceBrand: undefined;

	private readonly _proxy: INapUsageService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxy = ProxyChannel.toService<INapUsageService>(
			mainProcessService.getChannel('void-channel-nap-usage')
		);
	}

	async trackUsage(tokens: number): Promise<NapUsageResponse> {
		return this._proxy.trackUsage(tokens);
	}

	async reportUsage(report: NapUsageReport): Promise<NapUsageResponse> {
		return this._proxy.reportUsage(report);
	}

	async getPendingCount(): Promise<number> {
		return this._proxy.getPendingCount();
	}

	async forceSync(): Promise<void> {
		return this._proxy.forceSync();
	}
}

registerSingleton(INapUsageService, NapUsageService, InstantiationType.Eager);
