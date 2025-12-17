/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Usage report sent to the server
 */
export interface NapUsageReport {
	endpoint: string;
	tokens: number;
	metadata?: {
		model?: string;
		feature?: string;
		[key: string]: unknown;
	};
}

/**
 * Cached usage entry for offline sync
 */
export interface NapCachedUsage {
	report: NapUsageReport;
	timestamp: number;
	synced: boolean;
}

/**
 * Response from usage tracking API
 */
export interface NapUsageResponse {
	success: boolean;
	error?: string;
}

/**
 * Local usage cache state
 */
export interface NapUsageCacheState {
	pendingReports: NapCachedUsage[];
	lastSync?: number;
}
