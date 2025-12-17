/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { NapUsageInfo } from './napAuthTypes.js';

/**
 * Subscription status from the server
 */
export interface NapSubscriptionStatus {
	planName: string;
	status: 'active' | 'expired' | 'cancelled' | 'trial';
	expiryDate?: string;
	limits: {
		tokens: number;
		requests: number;
		devices: number;
	};
	usage: NapUsageInfo;
}

/**
 * Response from subscription API
 */
export interface NapSubscriptionResponse {
	success: boolean;
	error?: string;
	subscription?: NapSubscriptionStatus;
}

/**
 * Local subscription state
 */
export interface NapSubscriptionState {
	subscription?: NapSubscriptionStatus;
	lastFetched?: number;
}
