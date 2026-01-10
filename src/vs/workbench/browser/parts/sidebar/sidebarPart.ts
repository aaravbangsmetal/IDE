/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/sidebarpart.css';
import './sidebarActions.js';
import { ActivityBarPosition, IWorkbenchLayoutService, LayoutSettings, Parts, Position as SideBarPosition } from '../../../services/layout/browser/layoutService.js';
import { SidebarFocusContext, ActiveViewletContext } from '../../../common/contextkeys.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { contrastBorder } from '../../../../platform/theme/common/colorRegistry.js';
import { SIDE_BAR_TITLE_FOREGROUND, SIDE_BAR_TITLE_BORDER, SIDE_BAR_BACKGROUND, SIDE_BAR_FOREGROUND, SIDE_BAR_BORDER, SIDE_BAR_DRAG_AND_DROP_BACKGROUND, ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, ACTIVITY_BAR_TOP_FOREGROUND, ACTIVITY_BAR_TOP_ACTIVE_BORDER, ACTIVITY_BAR_TOP_INACTIVE_FOREGROUND, ACTIVITY_BAR_TOP_DRAG_AND_DROP_BORDER } from '../../../common/theme.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { LayoutPriority } from '../../../../base/browser/ui/grid/grid.js';
import { assertIsDefined } from '../../../../base/common/types.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { AbstractPaneCompositePart, CompositeBarPosition } from '../paneCompositePart.js';
import { ActivityBarCompositeBar, ActivitybarPart } from '../activitybar/activitybarPart.js';
import { ActionsOrientation } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IPaneCompositeBarOptions } from '../paneCompositeBar.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Action2, IMenuService, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Separator } from '../../../../base/common/actions.js';
import { ToggleActivityBarVisibilityActionId } from '../../actions/layoutActions.js';
import { localize2 } from '../../../../nls.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { $, append, addDisposableListener, EventType, clearNode } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';

export class SidebarPart extends AbstractPaneCompositePart {

	static readonly activeViewletSettingsKey = 'workbench.sidebar.activeviewletid';

	//#region IView

	readonly minimumWidth: number = 170;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;
	override get snap(): boolean { return true; }

	readonly priority: LayoutPriority = LayoutPriority.Low;

	get preferredWidth(): number | undefined {
		const viewlet = this.getActivePaneComposite();

		if (!viewlet) {
			return;
		}

		const width = viewlet.getOptimalWidth();
		if (typeof width !== 'number') {
			return;
		}

		return Math.max(width, 300);
	}

	private readonly activityBarPart = this._register(this.instantiationService.createInstance(ActivitybarPart, this));

	private verticalListViewContainer: HTMLElement | undefined;
	private verticalListItemsContainer: HTMLElement | undefined;
	private isVerticalListOpen: boolean = false;

	//#endregion

	constructor(
		@INotificationService notificationService: INotificationService,
		@IStorageService storageService: IStorageService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMenuService menuService: IMenuService,
	) {
		super(
			Parts.SIDEBAR_PART,
			{ hasTitle: true, borderWidth: () => (this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder)) ? 1 : 0 },
			SidebarPart.activeViewletSettingsKey,
			ActiveViewletContext.bindTo(contextKeyService),
			SidebarFocusContext.bindTo(contextKeyService),
			'sideBar',
			'viewlet',
			SIDE_BAR_TITLE_FOREGROUND,
			SIDE_BAR_TITLE_BORDER,
			notificationService,
			storageService,
			contextMenuService,
			layoutService,
			keybindingService,
			hoverService,
			instantiationService,
			themeService,
			viewDescriptorService,
			contextKeyService,
			extensionService,
			menuService,
		);

		// Force activity bar to TOP position for horizontal toolbar
		this.configurationService.updateValue(LayoutSettings.ACTIVITY_BAR_LOCATION, ActivityBarPosition.TOP);

		this.rememberActivityBarVisiblePosition();
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(LayoutSettings.ACTIVITY_BAR_LOCATION)) {
				// Prevent changing from TOP position
				const currentPosition = this.configurationService.getValue<ActivityBarPosition>(LayoutSettings.ACTIVITY_BAR_LOCATION);
				if (currentPosition !== ActivityBarPosition.TOP) {
					this.configurationService.updateValue(LayoutSettings.ACTIVITY_BAR_LOCATION, ActivityBarPosition.TOP);
				}
				this.onDidChangeActivityBarLocation();
			}
		}));

		// Filter pins after extensions are registered
		extensionService.whenInstalledExtensionsRegistered().then(() => {
			this.filterPinnedViewContainers(viewDescriptorService);
		});

		// Also filter when view containers change
		this._register(viewDescriptorService.onDidChangeViewContainers(() => {
			setTimeout(() => this.filterPinnedViewContainers(viewDescriptorService), 100);
		}));

		this.registerActions();
	}

	private filterPinnedViewContainers(viewDescriptorService: IViewDescriptorService): void {
		if (!this.shouldShowCompositeBar()) {
			return;
		}

		// Access the paneCompositeBar through the updateCompositeBar method's result
		// We need to wait for it to be created
		setTimeout(() => {
			const paneCompositeBar = (this as any).paneCompositeBar?.value;
			if (!paneCompositeBar) {
				return;
			}

			const location = ViewContainerLocation.Sidebar;
			const allViewContainers = viewDescriptorService.getViewContainersByLocation(location);

			// Access the internal composite bar
			const internalCompositeBar = (paneCompositeBar as any).compositeBar;

			if (internalCompositeBar) {
				// Pin ALL items so overflow button appears
				for (const container of allViewContainers) {
					if (!internalCompositeBar.isPinned(container.id)) {
						internalCompositeBar.pin(container.id);
					}
				}

				// Override updateCompositeSwitcher to force exactly 4 items visible + overflow
				const originalUpdateCompositeSwitcher = (internalCompositeBar as any).updateCompositeSwitcher;
				if (originalUpdateCompositeSwitcher && !(internalCompositeBar as any)._updateOverridden) {
					const sidebarPart = this;
					(internalCompositeBar as any).updateCompositeSwitcher = function (donotTrigger?: boolean) {
						// Force dimension to show exactly 4 main items + chevron
						const originalDimension = (this as any).dimension;
						if (originalDimension) {
							// Need room for 4 items + overflow chevron
							// 4 items * 50px = 200px, but we need it tight enough to trigger overflow
							// Setting it to 220px ensures overflow appears
							const forcedDimension = {
								width: 220,
								height: originalDimension.height
							};
							(this as any).dimension = forcedDimension;
						}

						// Call original with forced dimension
						originalUpdateCompositeSwitcher.call(this, donotTrigger);

						// Restore original
						if (originalDimension) {
							(this as any).dimension = originalDimension;
						}

						// IMMEDIATELY hook the overflow action - no setTimeout!
						const overflowAction = (this as any).compositeOverflowAction;
						const overflowActionViewItem = (this as any).compositeOverflowActionViewItem;
						if (overflowAction && overflowActionViewItem && !overflowAction._verticalListHooked) {
							// Change icon to chevronDown FIRST before anything else
							overflowAction.classNames = ThemeIcon.asClassNameArray(Codicon.chevronDown);

							// Update DOM directly and immediately
							if (overflowActionViewItem.label) {
								const classList = overflowActionViewItem.label.classList;
								const oldCodicons: string[] = [];
								classList.forEach((c: string) => {
									if (c.startsWith('codicon-')) {
										oldCodicons.push(c);
									}
								});
								classList.remove(...oldCodicons);
								classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronDown));
							}

							// Force viewItem update to reflect icon change
							overflowActionViewItem.update();

							// Hook the action's run method
							overflowAction.run = () => {
								sidebarPart.toggleVerticalListView();
								return Promise.resolve();
							};

							// Also hook showMenu as backup
							overflowActionViewItem.showMenu = () => {
								sidebarPart.toggleVerticalListView();
							};

							overflowAction._verticalListHooked = true;
							overflowActionViewItem._verticalListHooked = true;
						}
					};
					(internalCompositeBar as any)._updateOverridden = true;
				}

				// Force update to trigger overflow creation
				const updateMethod = (internalCompositeBar as any).updateCompositeSwitcher;
				if (updateMethod) {
					setTimeout(() => {
						updateMethod.call(internalCompositeBar);
					}, 100);
				}
			}
		}, 200);
	}

	private onDidChangeActivityBarLocation(): void {
		this.activityBarPart.hide();

		this.updateCompositeBar();

		// Filter pins after composite bar is updated
		setTimeout(() => {
			const viewDescriptorService = (this as any).viewDescriptorService as IViewDescriptorService;
			if (viewDescriptorService) {
				this.filterPinnedViewContainers(viewDescriptorService);
			}
		}, 300);

		const id = this.getActiveComposite()?.getId();
		if (id) {
			this.onTitleAreaUpdate(id);
		}

		if (this.shouldShowActivityBar()) {
			this.activityBarPart.show();
		}

		this.rememberActivityBarVisiblePosition();
	}

	override updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.getContainer());

		container.style.backgroundColor = this.getColor(SIDE_BAR_BACKGROUND) || '';
		container.style.color = this.getColor(SIDE_BAR_FOREGROUND) || '';

		const borderColor = this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder);
		const isPositionLeft = this.layoutService.getSideBarPosition() === SideBarPosition.LEFT;
		container.style.borderRightWidth = borderColor && isPositionLeft ? '1px' : '';
		container.style.borderRightStyle = borderColor && isPositionLeft ? 'solid' : '';
		container.style.borderRightColor = isPositionLeft ? borderColor || '' : '';
		container.style.borderLeftWidth = borderColor && !isPositionLeft ? '1px' : '';
		container.style.borderLeftStyle = borderColor && !isPositionLeft ? 'solid' : '';
		container.style.borderLeftColor = !isPositionLeft ? borderColor || '' : '';
		container.style.outlineColor = this.getColor(SIDE_BAR_DRAG_AND_DROP_BACKGROUND) ?? '';
	}

	override layout(width: number, height: number, top: number, left: number): void {
		if (!this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			return;
		}

		super.layout(width, height, top, left);
	}

	protected override getTitleAreaDropDownAnchorAlignment(): AnchorAlignment {
		return this.layoutService.getSideBarPosition() === SideBarPosition.LEFT ? AnchorAlignment.LEFT : AnchorAlignment.RIGHT;
	}

	protected override updateCompositeBar(updateCompositeBarOption: boolean = false): void {
		super.updateCompositeBar(updateCompositeBarOption);

		// Filter pins after composite bar is created/updated
		if (this.shouldShowCompositeBar()) {
			setTimeout(() => {
				const viewDescriptorService = (this as any).viewDescriptorService as IViewDescriptorService;
				if (viewDescriptorService) {
					this.filterPinnedViewContainers(viewDescriptorService);
					this.createVerticalListView();
					this.hookOverflowAction();
				}
			}, 100);
		}
	}

	protected override createTitleArea(parent: HTMLElement): HTMLElement {
		const titleArea = super.createTitleArea(parent);

		// Create vertical list container after title area is created
		setTimeout(() => {
			this.createVerticalListView();
		}, 100);

		return titleArea;
	}

	private createVerticalListView(): void {
		const container = this.getContainer();
		if (!container || this.verticalListViewContainer) {
			return;
		}

		// Find the composite bar container - we want to put the dropdown right after it
		const compositeBarContainer = container.querySelector('.composite-bar-container');
		if (!compositeBarContainer) {
			console.warn('⚠️ Could not find composite bar container');
			return;
		}

		// Find the title element to position the dropdown right below the composite bar
		const titleElement = container.querySelector('.composite.title');
		if (!titleElement) {
			console.warn('⚠️ Could not find title element');
			return;
		}

		// Create container for vertical list - insert it after the title area but inside sidebar
		this.verticalListViewContainer = append(titleElement.parentElement || container, $('.sidebar-vertical-list-container'));
		this.verticalListViewContainer.style.display = 'none';

		// Position it right below the composite bar, staying within sidebar bounds
		// The composite bar height is approximately 40px
		const compositeBarHeight = (compositeBarContainer as HTMLElement).offsetHeight || 40;
		this.verticalListViewContainer.style.top = `${compositeBarHeight}px`;
		this.verticalListViewContainer.style.maxHeight = '400px';
		this.verticalListViewContainer.style.overflowY = 'auto';

		this.verticalListItemsContainer = append(this.verticalListViewContainer, $('.sidebar-vertical-list-items'));

		// Update vertical list when composite bar changes
		this._register(this.onDidCompositeOpen.event(() => {
			this.updateVerticalListView();
		}));

		// Update when view containers change
		const viewDescriptorService = (this as any).viewDescriptorService as IViewDescriptorService;
		if (viewDescriptorService) {
			this._register(viewDescriptorService.onDidChangeViewContainers(() => {
				setTimeout(() => this.updateVerticalListView(), 100);
			}));
		}

		this.updateVerticalListView();
	}

	private hookOverflowAction(): void {
		// Hook into overflow action to toggle vertical list instead of showing context menu
		// Try multiple times as the overflow action might be created later
		let attempts = 0;
		const tryHook = () => {
			attempts++;
			const paneCompositeBar = (this as any).paneCompositeBar?.value;
			if (paneCompositeBar) {
				const internalCompositeBar = (paneCompositeBar as any).compositeBar;
				if (internalCompositeBar) {
					const overflowAction = (internalCompositeBar as any).compositeOverflowAction;
					const overflowActionViewItem = (internalCompositeBar as any).compositeOverflowActionViewItem;

					if (overflowAction && overflowActionViewItem) {
						if (!overflowAction._verticalListHooked) {
							// Hook the action's run method (which calls the showMenu function passed to constructor)
							overflowAction.run = () => {
								this.toggleVerticalListView();
								return Promise.resolve();
							};

							// Also hook showMenu as backup
							overflowActionViewItem.showMenu = () => {
								this.toggleVerticalListView();
							};

							// Change icon to chevronDown initially (instead of Codicon.more)
							overflowAction.classNames = ThemeIcon.asClassNameArray(Codicon.chevronDown);
							// Trigger update to refresh the icon
							overflowActionViewItem.update();

							// Also update DOM directly to ensure icon changes
							if (overflowActionViewItem.label) {
								const classList = overflowActionViewItem.label.classList;
								const oldCodicons: string[] = [];
								classList.forEach((c: string) => {
									if (c.startsWith('codicon-')) {
										oldCodicons.push(c);
									}
								});
								classList.remove(...oldCodicons);
								classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronDown));
							}

							overflowAction._verticalListHooked = true;
							overflowActionViewItem._verticalListHooked = true;
						}
						return; // Successfully hooked
					}
				}
			}

			// Retry if not hooked yet and haven't exceeded attempts
			if (attempts < 10) {
				setTimeout(tryHook, 200);
			}
		};

		setTimeout(tryHook, 100);

		// Also hook when composite switcher updates (when overflow action is created)
		const paneCompositeBar = (this as any).paneCompositeBar?.value;
		if (paneCompositeBar) {
			const internalCompositeBar = (paneCompositeBar as any).compositeBar;
			if (internalCompositeBar) {
				const originalUpdateCompositeSwitcher = (internalCompositeBar as any).updateCompositeSwitcher;
				if (originalUpdateCompositeSwitcher && !(internalCompositeBar as any)._verticalListHookAdded) {
					(internalCompositeBar as any).updateCompositeSwitcher = function (...args: any[]) {
						const result = originalUpdateCompositeSwitcher.apply(this, args);
						// After update, try to hook overflow action
						setTimeout(() => {
							const overflowAction = (this as any).compositeOverflowAction;
							const overflowActionViewItem = (this as any).compositeOverflowActionViewItem;
							if (overflowAction && overflowActionViewItem && !overflowAction._verticalListHooked) {
								overflowAction.run = () => {
									(this as any)._sidebarPart?.toggleVerticalListView();
									return Promise.resolve();
								};
								overflowActionViewItem.showMenu = () => {
									(this as any)._sidebarPart?.toggleVerticalListView();
								};
								overflowAction.classNames = ThemeIcon.asClassNameArray(Codicon.chevronDown);
								overflowActionViewItem.update();
								overflowAction._verticalListHooked = true;
								overflowActionViewItem._verticalListHooked = true;
							}
						}, 50);
						return result;
					};
					(internalCompositeBar as any)._sidebarPart = this;
					(internalCompositeBar as any)._verticalListHookAdded = true;
				}
			}
		}
	}

	private updateVerticalListView(): void {
		if (!this.verticalListItemsContainer) {
			return;
		}

		// Clear existing items using DOM API (not innerHTML for Trusted Types)
		clearNode(this.verticalListItemsContainer);

		// Get all view containers
		const viewDescriptorService = (this as any).viewDescriptorService as IViewDescriptorService;
		if (!viewDescriptorService) {
			return;
		}

		const allViewContainers = viewDescriptorService.getViewContainersByLocation(ViewContainerLocation.Sidebar);

		// Sort containers to show main 4 first, then the rest
		const mainIds = ['workbench.view.explorer', 'workbench.view.search', 'workbench.view.scm', 'workbench.view.extensions'];

		// Separate main containers and others
		const mainContainers = mainIds
			.map(id => allViewContainers.find((c: any) => c.id === id))
			.filter(c => c !== undefined);

		const otherContainers = allViewContainers.filter((c: any) => !mainIds.includes(c.id));

		// Combine: main 4 first, then the rest
		const allContainers = [...mainContainers, ...otherContainers];

		if (allContainers.length === 0) {
			if (this.verticalListViewContainer) {
				this.verticalListViewContainer.style.display = 'none';
			}
			return;
		}

		// Create list items for each container
		const activeCompositeId = this.getActivePaneComposite()?.getId();

		for (const container of allContainers) {
			const item = append(this.verticalListItemsContainer, $('.sidebar-vertical-list-item'));

			if (container.id === activeCompositeId) {
				item.classList.add('active');
			}

			// Icon
			const icon = append(item, $('.item-icon'));
			const containerIcon = container.icon instanceof URI ? undefined : container.icon;
			icon.className = `item-icon ${ThemeIcon.asClassName(containerIcon || Codicon.package)}`;

			// Label - get name from view container model
			const label = append(item, $('.item-label'));
			const containerModel = viewDescriptorService.getViewContainerModel(container);
			const containerTitle = containerModel?.title || container.id;
			label.textContent = containerTitle;

			// Keyboard shortcut - try to find the command ID
			const commandId = `workbench.view.${container.id}`;
			const keybinding = this.keybindingService.lookupKeybinding(commandId);
			if (keybinding) {
				const keybindingEl = append(item, $('.item-keybinding'));
				keybindingEl.textContent = keybinding.getLabel() || '';
			}

			// Pin icon (if pinned)
			const paneCompositeBar = (this as any).paneCompositeBar?.value;
			if (paneCompositeBar) {
				const internalCompositeBar = (paneCompositeBar as any).compositeBar;
				if (internalCompositeBar?.isPinned(container.id)) {
					const pinIcon = append(item, $('.item-pin'));
					pinIcon.className = `item-pin ${ThemeIcon.asClassName(Codicon.pinned)}`;
				}
			}

			// Click handler
			addDisposableListener(item, EventType.CLICK, () => {
				this.openPaneComposite(container.id, true);
				this.toggleVerticalListView(false);
			});
		}

		// Update overflow button icon based on state
		this.updateOverflowButtonIcon();
	}

	private toggleVerticalListView(show?: boolean): void {
		if (show === undefined) {
			this.isVerticalListOpen = !this.isVerticalListOpen;
		} else {
			this.isVerticalListOpen = show;
		}

		if (this.verticalListViewContainer) {
			if (this.isVerticalListOpen) {
				this.updateVerticalListView();
				this.verticalListViewContainer.style.display = 'block';
			} else {
				this.verticalListViewContainer.style.display = 'none';
			}
		}

		this.updateOverflowButtonIcon();
	}

	private updateOverflowButtonIcon(): void {
		// Find the overflow button and update its icon
		const paneCompositeBar = (this as any).paneCompositeBar?.value;
		if (paneCompositeBar) {
			const internalCompositeBar = (paneCompositeBar as any).compositeBar;
			if (internalCompositeBar) {
				const overflowAction = (internalCompositeBar as any).compositeOverflowAction;
				const overflowViewItem = (internalCompositeBar as any).compositeOverflowActionViewItem;

				if (overflowAction && overflowViewItem) {
					// Update icon to chevron-up when open, chevron-down when closed
					const iconClass = this.isVerticalListOpen ? Codicon.chevronUp : Codicon.chevronDown;
					overflowAction.classNames = ThemeIcon.asClassNameArray(iconClass);

					// Update the view item to refresh the icon
					overflowViewItem.update();

					// Also update DOM directly as backup
					if (overflowViewItem.label) {
						// Remove old codicon classes and add new one
						const classList = overflowViewItem.label.classList;
						const oldCodicons: string[] = [];
						classList.forEach((c: string) => {
							if (c.startsWith('codicon-')) {
								oldCodicons.push(c);
							}
						});
						classList.remove(...oldCodicons);
						classList.add(...ThemeIcon.asClassNameArray(iconClass));
					}
				}
			}
		}
	}

	protected override createCompositeBar(): ActivityBarCompositeBar {
		return this.instantiationService.createInstance(ActivityBarCompositeBar, this.getCompositeBarOptions(), this.partId, this, false);
	}

	protected getCompositeBarOptions(): IPaneCompositeBarOptions {
		return {
			partContainerClass: 'sidebar',
			pinnedViewContainersKey: ActivitybarPart.pinnedViewContainersKey,
			placeholderViewContainersKey: ActivitybarPart.placeholderViewContainersKey,
			viewContainersWorkspaceStateKey: ActivitybarPart.viewContainersWorkspaceStateKey,
			icon: true, // Show only icons, no labels
			orientation: ActionsOrientation.HORIZONTAL,
			recomputeSizes: false, // Disable dynamic sizing to force overflow
			activityHoverOptions: {
				position: () => this.getCompositeBarPosition() === CompositeBarPosition.BOTTOM ? HoverPosition.ABOVE : HoverPosition.BELOW,
			},
			fillExtraContextMenuActions: actions => {
				if (this.getCompositeBarPosition() === CompositeBarPosition.TITLE) {
					const viewsSubmenuAction = this.getViewsSubmenuAction();
					if (viewsSubmenuAction) {
						actions.push(new Separator());
						actions.push(viewsSubmenuAction);
					}
				}
			},
			compositeSize: 50, // Size for each composite item to trigger overflow
			iconSize: 13, // Reduced by 20% from 16px
			overflowActionSize: 50, // Size for overflow dropdown button
			colors: theme => ({
				activeBackgroundColor: theme.getColor(SIDE_BAR_BACKGROUND),
				inactiveBackgroundColor: theme.getColor(SIDE_BAR_BACKGROUND),
				activeBorderBottomColor: theme.getColor(ACTIVITY_BAR_TOP_ACTIVE_BORDER),
				activeForegroundColor: theme.getColor(ACTIVITY_BAR_TOP_FOREGROUND),
				inactiveForegroundColor: theme.getColor(ACTIVITY_BAR_TOP_INACTIVE_FOREGROUND),
				badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
				badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
				dragAndDropBorder: theme.getColor(ACTIVITY_BAR_TOP_DRAG_AND_DROP_BORDER)
			}),
			compact: true
		};
	}

	protected shouldShowCompositeBar(): boolean {
		// Always show composite bar at top for horizontal toolbar
		return true;
	}

	private shouldShowActivityBar(): boolean {
		if (this.shouldShowCompositeBar()) {
			return false;
		}

		return this.configurationService.getValue(LayoutSettings.ACTIVITY_BAR_LOCATION) !== ActivityBarPosition.HIDDEN;
	}

	protected getCompositeBarPosition(): CompositeBarPosition {
		// Always return TOP to show horizontal toolbar at the top
		return CompositeBarPosition.TOP;
	}

	private rememberActivityBarVisiblePosition(): void {
		const activityBarPosition = this.configurationService.getValue<string>(LayoutSettings.ACTIVITY_BAR_LOCATION);
		if (activityBarPosition !== ActivityBarPosition.HIDDEN) {
			this.storageService.store(LayoutSettings.ACTIVITY_BAR_LOCATION, activityBarPosition, StorageScope.PROFILE, StorageTarget.USER);
		}
	}

	private getRememberedActivityBarVisiblePosition(): ActivityBarPosition {
		const activityBarPosition = this.storageService.get(LayoutSettings.ACTIVITY_BAR_LOCATION, StorageScope.PROFILE);
		switch (activityBarPosition) {
			case ActivityBarPosition.TOP: return ActivityBarPosition.TOP;
			case ActivityBarPosition.BOTTOM: return ActivityBarPosition.BOTTOM;
			default: return ActivityBarPosition.DEFAULT;
		}
	}

	override getPinnedPaneCompositeIds(): string[] {
		if (!this.shouldShowCompositeBar()) {
			return this.activityBarPart.getPinnedPaneCompositeIds();
		}

		// Filter to only return the 4 main items: Explorer, Search, Source Control, Extensions
		const mainViewContainers = ['workbench.view.explorer', 'workbench.view.search', 'workbench.view.scm', 'workbench.view.extensions'];
		const allPinned = super.getPinnedPaneCompositeIds();
		return allPinned.filter(id => mainViewContainers.includes(id));
	}

	override getVisiblePaneCompositeIds(): string[] {
		if (!this.shouldShowCompositeBar()) {
			return this.activityBarPart.getVisiblePaneCompositeIds();
		}

		// Filter to only show the 4 main items in the horizontal bar: Explorer, Search, Source Control, Extensions
		// Other items will be accessible via the dropdown overflow menu
		const mainViewContainers = ['workbench.view.explorer', 'workbench.view.search', 'workbench.view.scm', 'workbench.view.extensions'];
		const allVisible = super.getVisiblePaneCompositeIds();

		// Always include the active composite if it's not one of the main 4
		const activeComposite = this.getActivePaneComposite();
		const activeId = activeComposite?.getId();

		// Filter to main 4, but always include active if it exists
		const filtered = allVisible.filter(id => mainViewContainers.includes(id));
		if (activeId && !mainViewContainers.includes(activeId) && !filtered.includes(activeId)) {
			// Don't add active to filtered - it will show via overflow when active
		}

		return filtered;
	}

	override getPaneCompositeIds(): string[] {
		return this.shouldShowCompositeBar() ? super.getPaneCompositeIds() : this.activityBarPart.getPaneCompositeIds();
	}

	async focusActivityBar(): Promise<void> {
		if (this.configurationService.getValue(LayoutSettings.ACTIVITY_BAR_LOCATION) === ActivityBarPosition.HIDDEN) {
			await this.configurationService.updateValue(LayoutSettings.ACTIVITY_BAR_LOCATION, this.getRememberedActivityBarVisiblePosition());

			this.onDidChangeActivityBarLocation();
		}

		if (this.shouldShowCompositeBar()) {
			this.focusCompositeBar();
		} else {
			if (!this.layoutService.isVisible(Parts.ACTIVITYBAR_PART)) {
				this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART);
			}

			this.activityBarPart.show(true);
		}
	}

	private registerActions(): void {
		const that = this;
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ToggleActivityBarVisibilityActionId,
					title: localize2('toggleActivityBar', "Toggle Activity Bar Visibility"),
				});
			}
			run(): Promise<void> {
				const value = that.configurationService.getValue(LayoutSettings.ACTIVITY_BAR_LOCATION) === ActivityBarPosition.HIDDEN ? that.getRememberedActivityBarVisiblePosition() : ActivityBarPosition.HIDDEN;
				return that.configurationService.updateValue(LayoutSettings.ACTIVITY_BAR_LOCATION, value);
			}
		}));
	}

	toJSON(): object {
		return {
			type: Parts.SIDEBAR_PART
		};
	}
}
