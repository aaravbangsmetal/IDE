/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { mountVoidWelcome } from './react/out/void-welcome/index.js';

class WelcomeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.voidWelcome';

	private static _hasShown = false;

	constructor() {
		super();
		this._showWelcome();
	}

	private _showWelcome() {
		// Only show once per application launch
		if (WelcomeContribution._hasShown) return;
		WelcomeContribution._hasShown = true;

		const container = document.createElement('div');
		container.id = 'void-welcome-container';
		document.body.appendChild(container);

		mountVoidWelcome(container, {});
	}
}

// Register the contribution to be initialized during the AfterRestored phase
registerWorkbenchContribution2(WelcomeContribution.ID, WelcomeContribution, WorkbenchPhase.AfterRestored);
