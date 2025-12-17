/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import {
	NapDeviceInfo,
	NapLicenseValidationResponse,
	NapLicenseState,
	NapRegisteredDevice
} from './napLicenseTypes.js';

/**
 * Interface for NAP license service
 */
export interface INapLicenseService {
	readonly _serviceBrand: undefined;

	/**
	 * Get device information for this machine
	 */
	getDeviceInfo(): Promise<NapDeviceInfo>;

	/**
	 * Validate license and register device
	 */
	validateLicense(): Promise<NapLicenseValidationResponse>;

	/**
	 * Get list of registered devices
	 */
	getDevices(): Promise<NapRegisteredDevice[]>;

	/**
	 * Remove a device from the account
	 */
	removeDevice(deviceUuid: string): Promise<boolean>;

	/**
	 * Get current license state
	 */
	getLicenseState(): Promise<NapLicenseState>;

	/**
	 * Check if license is valid
	 */
	isLicenseValid(): Promise<boolean>;
}

export const INapLicenseService = createDecorator<INapLicenseService>('napLicenseService');

/**
 * Client-side IPC proxy for NAP license service.
 */
export class NapLicenseService implements INapLicenseService {
	readonly _serviceBrand: undefined;

	private readonly _proxy: INapLicenseService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxy = ProxyChannel.toService<INapLicenseService>(
			mainProcessService.getChannel('void-channel-nap-license')
		);
	}

	async getDeviceInfo(): Promise<NapDeviceInfo> {
		return this._proxy.getDeviceInfo();
	}

	async validateLicense(): Promise<NapLicenseValidationResponse> {
		return this._proxy.validateLicense();
	}

	async getDevices(): Promise<NapRegisteredDevice[]> {
		return this._proxy.getDevices();
	}

	async removeDevice(deviceUuid: string): Promise<boolean> {
		return this._proxy.removeDevice(deviceUuid);
	}

	async getLicenseState(): Promise<NapLicenseState> {
		return this._proxy.getLicenseState();
	}

	async isLicenseValid(): Promise<boolean> {
		return this._proxy.isLicenseValid();
	}
}

registerSingleton(INapLicenseService, NapLicenseService, InstantiationType.Eager);
