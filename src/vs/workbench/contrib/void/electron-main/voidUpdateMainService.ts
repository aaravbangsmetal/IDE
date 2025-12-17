/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';
import { VoidCheckUpdateRespose, NapUpdateResponse } from '../common/voidUpdateServiceTypes.js';



export class VoidMainUpdateService extends Disposable implements IVoidUpdateService {
	_serviceBrand: undefined;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService,
	) {
		super()
	}

	/**
	 * Get NAP API URL from product config
	 */
	private get _napApiUrl(): string {
		return (this._productService as any).napApiUrl || '';
	}

	/**
	 * Get current platform identifier
	 */
	private get _platform(): string {
		if (isMacintosh) return 'darwin';
		if (isWindows) return 'win32';
		return 'linux';
	}


	async check(explicit: boolean): Promise<VoidCheckUpdateRespose> {

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

		if (isDevMode) {
			return { message: null } as const
		}

		// Try NAP update API first
		const napResult = await this._checkNapUpdates(explicit);
		if (napResult) {
			return napResult;
		}

		// if disabled and not explicitly checking, return early
		if (this._updateService.state.type === StateType.Disabled) {
			if (!explicit)
				return { message: null } as const
		}

		this._updateService.checkForUpdates(false) // implicity check, then handle result ourselves

		console.log('updateState', this._updateService.state)

		if (this._updateService.state.type === StateType.Uninitialized) {
			// The update service hasn't been initialized yet
			return { message: explicit ? 'Checking for updates soon...' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.Idle) {
			// No updates currently available
			return { message: explicit ? 'No updates found!' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.CheckingForUpdates) {
			// Currently checking for updates
			return { message: explicit ? 'Checking for updates...' : null } as const
		}

		if (this._updateService.state.type === StateType.AvailableForDownload) {
			// Update available but requires manual download (mainly for Linux)
			return { message: 'A new update is available!', action: 'download', } as const
		}

		if (this._updateService.state.type === StateType.Downloading) {
			// Update is currently being downloaded
			return { message: explicit ? 'Currently downloading update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Downloaded) {
			// Update has been downloaded but not yet ready
			return { message: explicit ? 'An update is ready to be applied!' : null, action: 'apply' } as const
		}

		if (this._updateService.state.type === StateType.Updating) {
			// Update is being applied
			return { message: explicit ? 'Applying update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Ready) {
			// Update is ready
			return { message: 'Restart Void to update!', action: 'restart' } as const
		}

		if (this._updateService.state.type === StateType.Disabled) {
			return await this._manualCheckGHTagIfDisabled(explicit)
		}
		return null
	}

	/**
	 * Check for updates using NAP's update API
	 */
	private async _checkNapUpdates(explicit: boolean): Promise<VoidCheckUpdateRespose> {
		if (!this._napApiUrl) {
			return null; // NAP not configured, fall through to default
		}

		try {
			const currentVersion = (this._productService as any).voidVersion || this._productService.version;
			const url = `${this._napApiUrl}/api/updates/latest?platform=${this._platform}&current_version=${currentVersion}`;

			console.log('[VoidMainUpdateService] Checking NAP updates:', url);
			const response = await fetch(url);

			// 204 No Content means no update available
			if (response.status === 204) {
				return explicit ? { message: 'NAP-IDE is up-to-date!' } : null;
			}

			if (!response.ok) {
				console.warn('[VoidMainUpdateService] NAP update check failed:', response.status);
				return null; // Fall through to default update mechanism
			}

			const data: NapUpdateResponse = await response.json();

			// Compare versions
			if (data.version === currentVersion) {
				return explicit ? { message: 'NAP-IDE is up-to-date!' } : null;
			}

			// Update available
			let message = `A new version (${data.version}) is available!`;
			if (data.mandatory) {
				message = `A mandatory update (${data.version}) is required!`;
			}
			if (data.notes) {
				message += ` ${data.notes}`;
			}

			return {
				message,
				action: 'download'
			} as const;

		} catch (error) {
			console.error('[VoidMainUpdateService] NAP update check error:', error);
			return null; // Fall through to default
		}
	}



	private async _manualCheckGHTagIfDisabled(explicit: boolean): Promise<VoidCheckUpdateRespose> {
		try {
			const response = await fetch('https://api.github.com/repos/voideditor/binaries/releases/latest');

			const data = await response.json();
			const version = data.tag_name;

			const myVersion = this._productService.version
			const latestVersion = version

			const isUpToDate = myVersion === latestVersion // only makes sense if response.ok

			let message: string | null
			let action: 'reinstall' | undefined

			// explicit
			if (explicit) {
				if (response.ok) {
					if (!isUpToDate) {
						message = 'A new version of Void is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!'
						action = 'reinstall'
					}
					else {
						message = 'Void is up-to-date!'
					}
				}
				else {
					message = `An error occurred when fetching the latest GitHub release tag. Please try again in ~5 minutes, or reinstall.`
					action = 'reinstall'
				}
			}
			// not explicit
			else {
				if (response.ok && !isUpToDate) {
					message = 'A new version of Void is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!'
					action = 'reinstall'
				}
				else {
					message = null
				}
			}
			return { message, action } as const
		}
		catch (e) {
			if (explicit) {
				return {
					message: `An error occurred when fetching the latest GitHub release tag: ${e}. Please try again in ~5 minutes.`,
					action: 'reinstall',
				}
			}
			else {
				return { message: null } as const
			}
		}
	}
}
