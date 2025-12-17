/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NAP_USAGE_CACHE_KEY } from '../common/storageKeys.js';
import { INapUsageService } from '../common/napUsageService.js';
import { INapAuthService } from '../common/napAuthService.js';
import { NapUsageReport, NapUsageResponse, NapCachedUsage, NapUsageCacheState } from '../common/napUsageTypes.js';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Main process service for tracking and reporting usage to NAP servers.
 */
export class NapUsageMainService extends Disposable implements INapUsageService {
	_serviceBrand: undefined;

	private _cacheState: NapUsageCacheState = { pendingReports: [] };
	private _syncTimer: NodeJS.Timeout | undefined;

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
		this._startSyncTimer();
	}

	/**
	 * Get the NAP API base URL from product configuration
	 */
	private get _apiUrl(): string {
		return (this._productService as any).napApiUrl || 'https://nap-ide.com';
	}

	/**
	 * Load cached usage data from storage
	 */
	private async _loadCache(): Promise<void> {
		try {
			const storedData = this._appStorage.get(NAP_USAGE_CACHE_KEY, StorageScope.APPLICATION);
			if (storedData) {
				this._cacheState = JSON.parse(storedData);
				this._logService.trace('[NapUsageMainService] Loaded usage cache with',
					this._cacheState.pendingReports.length, 'pending reports');
			}
		} catch (error) {
			this._logService.error('[NapUsageMainService] Failed to load cache:', error);
		}
	}

	/**
	 * Save cache state to storage
	 */
	private async _saveCache(): Promise<void> {
		try {
			this._appStorage.store(
				NAP_USAGE_CACHE_KEY,
				JSON.stringify(this._cacheState),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this._logService.error('[NapUsageMainService] Failed to save cache:', error);
		}
	}

	/**
	 * Start periodic sync timer
	 */
	private _startSyncTimer(): void {
		this._syncTimer = setInterval(() => {
			this._syncPendingReports();
		}, SYNC_INTERVAL);
	}

	/**
	 * Sync pending reports to server
	 */
	private async _syncPendingReports(): Promise<void> {
		const unsynced = this._cacheState.pendingReports.filter(r => !r.synced);
		if (unsynced.length === 0) {
			return;
		}

		this._logService.trace('[NapUsageMainService] Syncing', unsynced.length, 'pending reports');

		for (const cached of unsynced) {
			const result = await this._sendReport(cached.report);
			if (result.success) {
				cached.synced = true;
			}
		}

		// Clean up synced reports older than 24 hours
		const cutoff = Date.now() - (24 * 60 * 60 * 1000);
		this._cacheState.pendingReports = this._cacheState.pendingReports.filter(
			r => !r.synced || r.timestamp > cutoff
		);
		this._cacheState.lastSync = Date.now();

		await this._saveCache();
	}

	/**
	 * Send a usage report to the server
	 */
	private async _sendReport(report: NapUsageReport): Promise<NapUsageResponse> {
		const token = await this._authService.getAccessToken();
		if (!token) {
			return { success: false, error: 'Not authenticated' };
		}

		try {
			const response = await fetch(`${this._apiUrl}/api/usage/report`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(report)
			});

			if (!response.ok) {
				return { success: false, error: `HTTP ${response.status}` };
			}

			return { success: true };
		} catch (error) {
			this._logService.error('[NapUsageMainService] Failed to send report:', error);
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Track tokens used for an AI feature
	 */
	async trackUsage(tokens: number): Promise<NapUsageResponse> {
		return this.reportUsage({
			endpoint: 'ai-completion',
			tokens,
			metadata: {}
		});
	}

	/**
	 * Report detailed usage with metadata
	 */
	async reportUsage(report: NapUsageReport): Promise<NapUsageResponse> {
		this._logService.trace('[NapUsageMainService] Reporting usage:', report.tokens, 'tokens for', report.endpoint);

		// Cache the report
		const cached: NapCachedUsage = {
			report,
			timestamp: Date.now(),
			synced: false
		};
		this._cacheState.pendingReports.push(cached);
		await this._saveCache();

		// Try to send immediately
		const result = await this._sendReport(report);
		if (result.success) {
			cached.synced = true;
			await this._saveCache();
		}

		return result;
	}

	/**
	 * Get pending (unsynced) report count
	 */
	async getPendingCount(): Promise<number> {
		return this._cacheState.pendingReports.filter(r => !r.synced).length;
	}

	/**
	 * Force sync all pending reports
	 */
	async forceSync(): Promise<void> {
		await this._syncPendingReports();
	}

	override dispose(): void {
		if (this._syncTimer) {
			clearInterval(this._syncTimer);
		}
		super.dispose();
	}
}
