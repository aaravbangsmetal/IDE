/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { NapPlanInfo, NapUser, NapUsageInfo } from './napAuthTypes.js';

/**
 * Device information for license registration
 */
export interface NapDeviceInfo {
	deviceId: string;
	deviceName: string;
	platform: 'darwin' | 'win32' | 'linux';
}

/**
 * Registered device returned from server
 */
export interface NapRegisteredDevice {
	id: string;
	deviceId: string;
	deviceName: string;
	platform: string;
	lastSeen: string;
	createdAt: string;
}

/**
 * Response from license validation API
 */
export interface NapLicenseValidationResponse {
	valid: boolean;
	reason?: 'limit_exceeded' | 'expired' | 'invalid_token' | 'not_found';
	message?: string;
	user?: NapUser;
	plan?: NapPlanInfo;
	usage?: NapUsageInfo;
}

/**
 * Local license state stored in state service
 */
export interface NapLicenseState {
	isValid: boolean;
	deviceId?: string;
	lastValidated?: number; // Unix timestamp
	reason?: string;
	message?: string;
}

/**
 * Response from get devices API
 */
export interface NapDevicesResponse {
	devices: NapRegisteredDevice[];
}
