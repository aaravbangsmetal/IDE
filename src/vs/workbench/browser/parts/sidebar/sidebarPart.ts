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

			const mainViewContainers = ['workbench.view.explorer', 'workbench.view.search', 'workbench.view.scm', 'workbench.view.extensions'];
			const location = ViewContainerLocation.Sidebar;
			const allViewContainers = viewDescriptorService.getViewContainersByLocation(location);

			// Access the internal composite bar to unpin items
			const internalCompositeBar = (paneCompositeBar as any).compositeBar;

			if (internalCompositeBar) {
				// Override getOverflowingComposites to include all visible items, not just pinned ones
				const originalGetOverflowingComposites = (internalCompositeBar as any).getOverflowingComposites;
				if (originalGetOverflowingComposites && !(internalCompositeBar as any)._overflowOverridden) {
					(internalCompositeBar as any).getOverflowingComposites = function () {
						const model = (this as any).model;
						const visibleComposites = (this as any).visibleComposites || [];

						// Get all visible items that aren't in the visible composites (main 4)
						const allVisibleIds = model.visibleItems.map((item: any) => item.id);
						const overflowingIds = allVisibleIds.filter((id: string) => !visibleComposites.includes(id));

						// Also include active item if it's not already included
						if (model.activeItem && !overflowingIds.includes(model.activeItem.id) && !visibleComposites.includes(model.activeItem.id)) {
							overflowingIds.push(model.activeItem.id);
						}

						return model.visibleItems
							.filter((c: any) => overflowingIds.includes(c.id))
							.map((item: any) => {
								const action = (this as any).getAction(item.id);
								return { id: item.id, name: action?.label || item.name };
							});
					};
					(internalCompositeBar as any)._overflowOverridden = true;
				}

				for (const container of allViewContainers) {
					if (!mainViewContainers.includes(container.id)) {
						// Unpin items that aren't in the main 4 - they'll go to overflow
						if (internalCompositeBar.isPinned(container.id)) {
							internalCompositeBar.unpin(container.id);
						}
					} else {
						// Ensure main items are pinned
						if (!internalCompositeBar.isPinned(container.id)) {
							internalCompositeBar.pin(container.id);
						}
					}
				}

				// Force update to ensure overflow shows when there are more than 4 items
				const updateMethod = (internalCompositeBar as any).updateCompositeSwitcher;
				if (updateMethod) {
					// Trigger update - this will create overflow if needed
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
				}
			}, 100);
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
			recomputeSizes: true,
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
			compositeSize: 0,
			iconSize: 13, // Reduced by 20% from 16px
			overflowActionSize: 30, // Size for overflow dropdown button
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
