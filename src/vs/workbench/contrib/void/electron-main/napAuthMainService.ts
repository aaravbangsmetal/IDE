/*--------------------------------------------------------------------------------------
 *  Copyright 2025 NAP-IDE. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { BrowserWindow } from 'electron';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NAP_AUTH_STORAGE_KEY } from '../common/storageKeys.js';
import { INapAuthService } from '../common/napAuthService.js';
import { NapAuthState, NapAuthResponse } from '../common/napAuthTypes.js';

/**
 * Main process service for NAP authentication.
 * Handles OAuth flow via browser window and secure token storage.
 */
export class NapAuthMainService extends Disposable implements INapAuthService {
	_serviceBrand: undefined;

	private _authWindow: BrowserWindow | null = null;
	private _authState: NapAuthState = { isAuthenticated: false };

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
		@IEncryptionMainService private readonly _encryptionService: IEncryptionMainService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		await this._appStorage.whenReady;
		await this._loadStoredAuth();
	}

	/**
	 * Get the NAP API base URL from product configuration
	 */
	private get _apiUrl(): string {
		return (this._productService as any).napApiUrl || 'https://nap-ide.com';
	}

	/**
	 * Get the OAuth callback path from product configuration
	 */
	private get _authCallback(): string {
		return (this._productService as any).napAuthCallback || '/electron-auth-success';
	}

	/**
	 * Load stored authentication state from secure storage
	 */
	private async _loadStoredAuth(): Promise<void> {
		try {
			const storedData = this._appStorage.get(NAP_AUTH_STORAGE_KEY, StorageScope.APPLICATION);
			if (!storedData) {
				this._logService.trace('[NapAuthMainService] No stored auth state found');
				return;
			}

			const decrypted = await this._encryptionService.decrypt(storedData);
			this._authState = JSON.parse(decrypted);
			this._logService.trace('[NapAuthMainService] Loaded stored auth state');

			// Check if token has expired
			if (this._authState.tokenExpiry && Date.now() > this._authState.tokenExpiry) {
				this._logService.trace('[NapAuthMainService] Token has expired, attempting refresh');
				await this.refreshToken();
			}
		} catch (error) {
			this._logService.error('[NapAuthMainService] Failed to load stored auth:', error);
			this._authState = { isAuthenticated: false };
		}
	}

	/**
	 * Save authentication state to secure storage
	 */
	private async _saveAuthState(): Promise<void> {
		try {
			const encrypted = await this._encryptionService.encrypt(JSON.stringify(this._authState));
			this._appStorage.store(NAP_AUTH_STORAGE_KEY, encrypted, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._logService.trace('[NapAuthMainService] Saved auth state');
		} catch (error) {
			this._logService.error('[NapAuthMainService] Failed to save auth state:', error);
		}
	}

	/**
	 * Open browser window for OAuth login
	 */
	async login(): Promise<NapAuthResponse> {
		if (this._authWindow && !this._authWindow.isDestroyed()) {
			this._authWindow.focus();
			return { success: false, error: 'Login window already open' };
		}

		return new Promise((resolve) => {
			const loginUrl = `${this._apiUrl}/auth/login?redirect_to=${encodeURIComponent(this._authCallback)}`;
			this._logService.trace('[NapAuthMainService] Opening login window:', loginUrl);

			this._authWindow = new BrowserWindow({
				width: 500,
				height: 700,
				show: true,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true
				}
			});

			this._authWindow.loadURL(loginUrl);

			// Listen for redirect to auth callback
			this._authWindow.webContents.on('will-redirect', async (_event, url) => {
				if (url.includes(this._authCallback)) {
					this._logService.trace('[NapAuthMainService] Received auth callback redirect');
					await this._handleAuthCallback(url, resolve);
				}
			});

			// Also check on navigation in case of direct navigation
			this._authWindow.webContents.on('did-navigate', async (_event, url) => {
				if (url.includes(this._authCallback)) {
					this._logService.trace('[NapAuthMainService] Received auth callback navigation');
					await this._handleAuthCallback(url, resolve);
				}
			});

			this._authWindow.on('closed', () => {
				this._authWindow = null;
				if (!this._authState.isAuthenticated) {
					resolve({ success: false, error: 'Login window closed' });
				}
			});
		});
	}

	/**
	 * Handle OAuth callback URL and extract token
	 */
	private async _handleAuthCallback(url: string, resolve: (value: NapAuthResponse) => void): Promise<void> {
		try {
			const urlObj = new URL(url);
			const token = urlObj.searchParams.get('token');
			const refreshToken = urlObj.searchParams.get('refresh_token');

			if (!token) {
				this._logService.error('[NapAuthMainService] No token in callback URL');
				resolve({ success: false, error: 'No token received' });
				this._closeAuthWindow();
				return;
			}

			// Update auth state initially
			this._authState = {
				isAuthenticated: true,
				accessToken: token,
				refreshToken: refreshToken || undefined,
				tokenExpiry: Date.now() + (60 * 60 * 1000) // Default 1 hour expiry
			};

			// Fetch user info to confirm account
			try {
				const userResponse = await fetch(`${this._apiUrl}/api/auth/me`, {
					headers: {
						'Authorization': `Bearer ${token}`
					}
				});
				if (userResponse.ok) {
					const userData = await userResponse.json();
					this._authState.user = userData.user;
					this._authState.plan = userData.plan;
				}
			} catch (error) {
				this._logService.warn('[NapAuthMainService] Failed to fetch user info:', error);
			}

			await this._saveAuthState();
			this._closeAuthWindow();

			this._logService.trace('[NapAuthMainService] Login successful');
			resolve({ success: true, state: this._authState });
		} catch (error) {
			this._logService.error('[NapAuthMainService] Failed to process auth callback:', error);
			resolve({ success: false, error: String(error) });
			this._closeAuthWindow();
		}
	}

	private _closeAuthWindow(): void {
		if (this._authWindow && !this._authWindow.isDestroyed()) {
			this._authWindow.close();
			this._authWindow = null;
		}
	}

	/**
	 * Logout and clear stored credentials
	 */
	async logout(): Promise<NapAuthResponse> {
		this._logService.trace('[NapAuthMainService] Logging out');

		// Call logout API if we have a token
		if (this._authState.accessToken) {
			try {
				await fetch(`${this._apiUrl}/api/auth/logout`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${this._authState.accessToken}`
					}
				});
			} catch (error) {
				this._logService.warn('[NapAuthMainService] Logout API call failed:', error);
			}
		}

		// Clear local state
		this._authState = { isAuthenticated: false };
		this._appStorage.remove(NAP_AUTH_STORAGE_KEY, StorageScope.APPLICATION);

		return { success: true };
	}

	/**
	 * Refresh the access token using the refresh token
	 */
	async refreshToken(): Promise<NapAuthResponse> {
		if (!this._authState.refreshToken) {
			this._logService.trace('[NapAuthMainService] No refresh token available');
			return { success: false, error: 'No refresh token' };
		}

		try {
			const response = await fetch(`${this._apiUrl}/api/auth/refresh`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ refresh_token: this._authState.refreshToken })
			});

			if (!response.ok) {
				throw new Error(`Refresh failed: ${response.status}`);
			}

			const data = await response.json();

			this._authState = {
				...this._authState,
				accessToken: data.access_token,
				refreshToken: data.refresh_token || this._authState.refreshToken,
				tokenExpiry: Date.now() + (60 * 60 * 1000)
			};

			await this._saveAuthState();
			this._logService.trace('[NapAuthMainService] Token refreshed successfully');

			return { success: true, state: this._authState };
		} catch (error) {
			this._logService.error('[NapAuthMainService] Token refresh failed:', error);
			// Clear auth state on refresh failure
			this._authState = { isAuthenticated: false };
			await this._saveAuthState();
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Get current authentication state
	 */
	async getAuthState(): Promise<NapAuthState> {
		return { ...this._authState };
	}

	/**
	 * Get the current access token (for use by other services)
	 */
	async getAccessToken(): Promise<string | undefined> {
		// Check if token needs refresh
		if (this._authState.isAuthenticated && this._authState.tokenExpiry) {
			// Refresh if less than 5 minutes remaining
			if (Date.now() > this._authState.tokenExpiry - (5 * 60 * 1000)) {
				await this.refreshToken();
			}
		}
		return this._authState.accessToken;
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		return this._authState.isAuthenticated;
	}
}
