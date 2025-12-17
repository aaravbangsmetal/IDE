/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NAP_SUBSCRIPTION_STORAGE_KEY } from '../common/storageKeys.js';
import { INapSubscriptionService } from '../common/napSubscriptionService.js';
import { INapAuthService } from '../common/napAuthService.js';
import { NapSubscriptionStatus, NapSubscriptionResponse, NapSubscriptionState } from '../common/napSubscriptionTypes.js';

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Main process service for subscription management.
 */
export class NapSubscriptionMainService extends Disposable implements INapSubscriptionService {
	_serviceBrand: undefined;

	private _state: NapSubscriptionState = {};

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
		@ILogService private readonly _logService: ILogService,
		@INapAuthService private readonly _authService: INapAuthService
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		await this._appStorage.whenReady;
		await this._loadCache();
	}

	/**
	 * Get the NAP API base URL from product configuration
	 */
	private get _apiUrl(): string {
		return (this._productService as any).napApiUrl || 'https://nap-ide.com';
	}

	/**
	 * Load cached subscription state
	 */
	private async _loadCache(): Promise<void> {
		try {
			const storedData = this._appStorage.get(NAP_SUBSCRIPTION_STORAGE_KEY, StorageScope.APPLICATION);
			if (storedData) {
				this._state = JSON.parse(storedData);
				this._logService.trace('[NapSubscriptionMainService] Loaded cached subscription');
			}
		} catch (error) {
			this._logService.error('[NapSubscriptionMainService] Failed to load cache:', error);
		}
	}

	/**
	 * Save subscription state to cache
	 */
	private async _saveCache(): Promise<void> {
		try {
			this._appStorage.store(
				NAP_SUBSCRIPTION_STORAGE_KEY,
				JSON.stringify(this._state),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this._logService.error('[NapSubscriptionMainService] Failed to save cache:', error);
		}
	}

	/**
	 * Check if cache is still valid
	 */
	private _isCacheValid(): boolean {
		if (!this._state.lastFetched) return false;
		return (Date.now() - this._state.lastFetched) < CACHE_DURATION;
	}

	/**
	 * Get subscription status from server
	 */
	async getSubscription(forceRefresh: boolean = false): Promise<NapSubscriptionResponse> {
		// Return cached if valid and not forcing refresh
		if (!forceRefresh && this._isCacheValid() && this._state.subscription) {
			return { success: true, subscription: this._state.subscription };
		}

		const token = await this._authService.getAccessToken();
		if (!token) {
			return { success: false, error: 'Not authenticated' };
		}

		try {
			const response = await fetch(`${this._apiUrl}/api/user/subscription`, {
				headers: {
					'Authorization': `Bearer ${token}`
				}
			});

			if (!response.ok) {
				this._logService.warn('[NapSubscriptionMainService] Failed to get subscription:', response.status);

				// Return cached on error if available
				if (this._state.subscription) {
					return { success: true, subscription: this._state.subscription };
				}
				return { success: false, error: `HTTP ${response.status}` };
			}

			const data: NapSubscriptionStatus = await response.json();

			this._state = {
				subscription: data,
				lastFetched: Date.now()
			};
			await this._saveCache();

			this._logService.trace('[NapSubscriptionMainService] Subscription fetched:', data.planName);
			return { success: true, subscription: data };
		} catch (error) {
			this._logService.error('[NapSubscriptionMainService] Error fetching subscription:', error);

			// Return cached on error if available
			if (this._state.subscription) {
				return { success: true, subscription: this._state.subscription };
			}
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Force refresh subscription from server
	 */
	async refreshSubscription(): Promise<NapSubscriptionResponse> {
		return this.getSubscription(true);
	}

	/**
	 * Check if subscription is active
	 */
	async isSubscriptionActive(): Promise<boolean> {
		const result = await this.getSubscription();
		return result.success && result.subscription?.status === 'active';
	}

	/**
	 * Get usage limits from subscription
	 */
	async getUsageLimits(): Promise<{ tokens: number; requests: number; devices: number } | null> {
		const result = await this.getSubscription();
		return result.subscription?.limits || null;
	}

	/**
	 * Get current usage from subscription
	 */
	async getCurrentUsage(): Promise<{ tokens: number; requests: number } | null> {
		const result = await this.getSubscription();
		return result.subscription?.usage || null;
	}
}
