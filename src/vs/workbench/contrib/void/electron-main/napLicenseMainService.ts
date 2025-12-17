/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { getdevDeviceId } from '../../../../base/node/id.js';
import { hostname } from 'os';
import { NAP_LICENSE_STORAGE_KEY, NAP_DEVICE_ID_KEY } from '../common/storageKeys.js';
import { INapLicenseService } from '../common/napLicenseService.js';
import { INapAuthService } from '../common/napAuthService.js';
import {
	NapDeviceInfo,
	NapLicenseValidationResponse,
	NapLicenseState,
	NapRegisteredDevice,
	NapDevicesResponse
} from '../common/napLicenseTypes.js';

/**
 * Main process service for NAP license validation and device management.
 */
export class NapLicenseMainService extends Disposable implements INapLicenseService {
	_serviceBrand: undefined;

	private _licenseState: NapLicenseState = { isValid: false };
	private _deviceId: string | undefined;

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
		await this._loadDeviceId();
		await this._loadStoredLicense();
	}

	/**
	 * Get the NAP API base URL from product configuration
	 */
	private get _apiUrl(): string {
		return (this._productService as any).napApiUrl || 'https://nap-ide.com';
	}

	/**
	 * Get the current platform identifier
	 */
	private get _platform(): 'darwin' | 'win32' | 'linux' {
		if (isMacintosh) return 'darwin';
		if (isWindows) return 'win32';
		return 'linux';
	}

	/**
	 * Load or generate device ID
	 */
	private async _loadDeviceId(): Promise<void> {
		// Check if we have a stored device ID
		const storedId = this._appStorage.get(NAP_DEVICE_ID_KEY, StorageScope.APPLICATION);
		if (storedId) {
			this._deviceId = storedId;
			this._logService.trace('[NapLicenseMainService] Loaded stored device ID');
			return;
		}

		// Generate new device ID using hardware identifiers
		try {
			this._deviceId = await getdevDeviceId((err) => {
				this._logService.error('[NapLicenseMainService] Device ID generation error:', err);
			});

			// Store the device ID
			this._appStorage.store(NAP_DEVICE_ID_KEY, this._deviceId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._logService.trace('[NapLicenseMainService] Generated and stored new device ID');
		} catch (error) {
			this._logService.error('[NapLicenseMainService] Failed to generate device ID:', error);
		}
	}

	/**
	 * Load stored license state
	 */
	private async _loadStoredLicense(): Promise<void> {
		try {
			const storedData = this._appStorage.get(NAP_LICENSE_STORAGE_KEY, StorageScope.APPLICATION);
			if (storedData) {
				this._licenseState = JSON.parse(storedData);
				this._logService.trace('[NapLicenseMainService] Loaded stored license state');
			}
		} catch (error) {
			this._logService.error('[NapLicenseMainService] Failed to load stored license:', error);
		}
	}

	/**
	 * Save license state to storage
	 */
	private async _saveLicenseState(): Promise<void> {
		try {
			this._appStorage.store(
				NAP_LICENSE_STORAGE_KEY,
				JSON.stringify(this._licenseState),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this._logService.error('[NapLicenseMainService] Failed to save license state:', error);
		}
	}

	/**
	 * Get device information for registration
	 */
	async getDeviceInfo(): Promise<NapDeviceInfo> {
		return {
			deviceId: this._deviceId || 'unknown',
			deviceName: hostname() || 'Unknown Device',
			platform: this._platform
		};
	}

	/**
	 * Validate license and register device with the server
	 */
	async validateLicense(): Promise<NapLicenseValidationResponse> {
		const token = await this._authService.getAccessToken();
		if (!token) {
			this._logService.trace('[NapLicenseMainService] No auth token, skipping validation');
			return { valid: false, reason: 'invalid_token', message: 'Not authenticated' };
		}

		const deviceInfo = await this.getDeviceInfo();
		this._logService.trace('[NapLicenseMainService] Validating license for device:', deviceInfo.deviceId);

		try {
			const response = await fetch(`${this._apiUrl}/api/license/validate`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					device_id: deviceInfo.deviceId,
					device_name: deviceInfo.deviceName,
					platform: deviceInfo.platform
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				this._logService.warn('[NapLicenseMainService] License validation failed:', response.status);

				this._licenseState = {
					isValid: false,
					deviceId: deviceInfo.deviceId,
					lastValidated: Date.now(),
					reason: errorData.reason || 'unknown',
					message: errorData.message || `HTTP ${response.status}`
				};
				await this._saveLicenseState();

				return {
					valid: false,
					reason: errorData.reason,
					message: errorData.message
				};
			}

			const data: NapLicenseValidationResponse = await response.json();

			this._licenseState = {
				isValid: data.valid,
				deviceId: deviceInfo.deviceId,
				lastValidated: Date.now(),
				reason: data.reason,
				message: data.message
			};
			await this._saveLicenseState();

			this._logService.trace('[NapLicenseMainService] License validation result:', data.valid);
			return data;
		} catch (error) {
			this._logService.error('[NapLicenseMainService] License validation error:', error);

			// On network error, use cached state if recent
			if (this._licenseState.lastValidated &&
				(Date.now() - this._licenseState.lastValidated) < (24 * 60 * 60 * 1000)) {
				this._logService.trace('[NapLicenseMainService] Using cached license state');
				return { valid: this._licenseState.isValid };
			}

			return { valid: false, reason: 'not_found', message: String(error) };
		}
	}

	/**
	 * Get list of registered devices
	 */
	async getDevices(): Promise<NapRegisteredDevice[]> {
		const token = await this._authService.getAccessToken();
		if (!token) {
			return [];
		}

		try {
			const response = await fetch(`${this._apiUrl}/api/user/devices`, {
				headers: {
					'Authorization': `Bearer ${token}`
				}
			});

			if (!response.ok) {
				this._logService.warn('[NapLicenseMainService] Failed to get devices:', response.status);
				return [];
			}

			const data: NapDevicesResponse = await response.json();
			return data.devices || [];
		} catch (error) {
			this._logService.error('[NapLicenseMainService] Error getting devices:', error);
			return [];
		}
	}

	/**
	 * Remove a device from the account
	 */
	async removeDevice(deviceUuid: string): Promise<boolean> {
		const token = await this._authService.getAccessToken();
		if (!token) {
			return false;
		}

		try {
			const response = await fetch(`${this._apiUrl}/api/user/devices?id=${deviceUuid}`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${token}`
				}
			});

			if (!response.ok) {
				this._logService.warn('[NapLicenseMainService] Failed to remove device:', response.status);
				return false;
			}

			this._logService.trace('[NapLicenseMainService] Device removed successfully');
			return true;
		} catch (error) {
			this._logService.error('[NapLicenseMainService] Error removing device:', error);
			return false;
		}
	}

	/**
	 * Get current license state
	 */
	async getLicenseState(): Promise<NapLicenseState> {
		return { ...this._licenseState };
	}

	/**
	 * Check if license is valid
	 */
	async isLicenseValid(): Promise<boolean> {
		return this._licenseState.isValid;
	}
}
