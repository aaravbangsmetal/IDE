/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * User information returned from authentication
 */
export interface NapUser {
	id: string;
	email: string;
}

/**
 * Plan information from the server
 */
export interface NapPlanInfo {
	name: string;
	isValid: boolean;
	expiry?: string;
	limits?: {
		devices: number;
		tokens: number;
		requests: number;
	};
}

/**
 * Usage information from the server
 */
export interface NapUsageInfo {
	tokens: number;
	requests: number;
}

/**
 * Complete authentication state stored locally
 */
export interface NapAuthState {
	isAuthenticated: boolean;
	accessToken?: string;
	refreshToken?: string;
	user?: NapUser;
	plan?: NapPlanInfo;
	tokenExpiry?: number; // Unix timestamp
}

/**
 * Response from auth operations
 */
export interface NapAuthResponse {
	success: boolean;
	error?: string;
	state?: NapAuthState;
}

/**
 * Token received from OAuth callback
 */
export interface NapOAuthToken {
	channel: 'auth-success';
	token: string;
	refreshToken?: string;
}
