/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { ChevronRight } from 'lucide-react';
import { ProviderName, providerNames } from '../../../../common/voidSettingsTypes.js';


import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { isLinux } from '../../../../../../../base/common/platform.js';

const OVERRIDE_VALUE = false

export const VoidOnboarding = () => {

	const voidSettingsState = useSettingsState()
	const isOnboardingComplete = voidSettingsState.globalSettings.isOnboardingComplete && !OVERRIDE_VALUE

	const isDark = useIsDark()

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[99999]
					transition-all duration-1000 ${isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}
				`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<VoidOnboardingContent />
				</ErrorBoundary>
			</div>
		</div>
	)
}

const VoidIcon = () => {
	const accessor = useAccessor()
	const themeService = accessor.get('IThemeService')

	const divRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		// void icon style
		const updateTheme = () => {
			const theme = themeService.getColorTheme().type
			const isDark = theme === ColorScheme.DARK || theme === ColorScheme.HIGH_CONTRAST_DARK
			if (divRef.current) {
				divRef.current.style.maxWidth = '220px'
				divRef.current.style.opacity = '50%'
				divRef.current.style.filter = isDark ? '' : 'invert(1)' //brightness(.5)
			}
		}
		updateTheme()
		const d = themeService.onDidColorThemeChange(updateTheme)
		return () => d.dispose()
	}, [])

	return <div ref={divRef} className='@@void-void-icon' />
}

const FADE_DURATION_MS = 2000

const FadeIn = ({ children, className, delayMs = 0, durationMs, ...props }: { children: React.ReactNode, delayMs?: number, durationMs?: number, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {

	const [opacity, setOpacity] = useState(0)

	const effectiveDurationMs = durationMs ?? FADE_DURATION_MS

	useEffect(() => {

		const timeout = setTimeout(() => {
			setOpacity(1)
		}, delayMs)

		return () => clearTimeout(timeout)
	}, [setOpacity, delayMs])


	return (
		<div className={className} style={{ opacity, transition: `opacity ${effectiveDurationMs}ms ease-in-out` }} {...props}>
			{children}
		</div>
	)
}

// Onboarding


// =============================================
// 	OnboardingPage
// 		title:
// 			div
// 				"Welcome to Void"
// 			image
// 		content:<></>
// 		title
// 		content
// 		prev/next

// 	OnboardingPage
// 		title:
// 			div
// 				"How would you like to use Void?"
// 		content:
// 			ModelQuestionContent
// 				|
// 					div
// 						"I want to:"
// 					div
// 						"Use the smartest models"
// 						"Keep my data fully private"
// 						"Save money"
// 						"I don't know"
// 				| div
// 					| div
// 						"We recommend using "
// 						"Set API"
// 					| div
// 						""
// 					| div
//
// 		title
// 		content
// 		prev/next
//
// 	OnboardingPage
// 		title
// 		content
// 		prev/next



const PreviousButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded text-void-fg-3 opacity-80 hover:brightness-115 duration-600 transition-all"
			{...props}
		>
			Back
		</button>
	)
}



const OnboardingPageShell = ({ top, bottom, content, hasMaxWidth = true, className = '', }: {
	top?: React.ReactNode,
	bottom?: React.ReactNode,
	content?: React.ReactNode,
	hasMaxWidth?: boolean,
	className?: string,
}) => {
	return (
		<div className={`h-[80vh] text-lg flex flex-col gap-4 w-full mx-auto ${hasMaxWidth ? 'max-w-[600px]' : ''} ${className}`}>
			{top && <FadeIn className='w-full mb-auto pt-16'>{top}</FadeIn>}
			{content && <FadeIn className='w-full my-auto'>{content}</FadeIn>}
			{bottom && <div className='w-full pb-8'>{bottom}</div>}
		</div>
	)
}







const PrimaryActionButton = ({ children, className, ringSize, ...props }: { children: React.ReactNode, ringSize?: undefined | 'xl' | 'screen' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {


	return (
		<button
			type='button'
			className={`
				flex items-center justify-center

				text-white dark:text-black
				bg-black/90 dark:bg-white/90

				${ringSize === 'xl' ? `
					gap-2 px-16 py-8
					transition-all duration-300 ease-in-out
					`
					: ringSize === 'screen' ? `
					gap-2 px-16 py-8
					transition-all duration-1000 ease-in-out
					`: ringSize === undefined ? `
					gap-1 px-4 py-2
					transition-all duration-300 ease-in-out
				`: ''}

				rounded-lg
				group
				${className}
			`}
			{...props}
		>
			{children}
			<ChevronRight
				className={`
					transition-all duration-300 ease-in-out

					transform
					group-hover:translate-x-1
					group-active:translate-x-1
				`}
			/>
		</button>
	)
}




const VoidOnboardingContent = () => {


	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidMetricsService = accessor.get('IMetricsService')
	const napAuthService = accessor.get('INapAuthService')

	const voidSettingsState = useSettingsState()

	const [pageIndex, setPageIndex] = useState(0)
	const [isAuthenticating, setIsAuthenticating] = useState(false)
	const [authError, setAuthError] = useState<string | null>(null)












	useEffect(() => {
		if (!voidSettingsState.globalSettings.isOnboardingComplete) {
			setPageIndex(0)
		}
	}, [setPageIndex, voidSettingsState.globalSettings.isOnboardingComplete])

	const handleLogin = async () => {
		setIsAuthenticating(true);
		setAuthError(null);
		try {
			const response = await napAuthService.login();
			if (response.success) {
				voidSettingsService.setGlobalSetting('isOnboardingComplete', true);
				voidMetricsService.capture('Completed Onboarding', {})
			} else {
				setAuthError(response.error || 'Login failed');
			}
		} catch (e) {
			setAuthError(String(e));
		} finally {
			setIsAuthenticating(false);
		}
	};


	const contentOfIdx: { [pageIndex: number]: React.ReactNode } = {
		0: <OnboardingPageShell
			content={
				<div className='flex flex-col items-center gap-8'>
					<div className="text-6xl font-light text-center">Welcome to Nap IDE</div>
					<div className="text-xl text-center opacity-70">The next generation editor designed for agents.</div>

					<div className='max-w-md w-full h-[30vh] mx-auto flex items-center justify-center'>
						{!isLinux && <VoidIcon />}
					</div>


					<FadeIn
						delayMs={1000}
					>
						<PrimaryActionButton
							onClick={() => { setPageIndex(1) }}
						>
							Continue
						</PrimaryActionButton>
					</FadeIn>

				</div>
			}
		/>,
		1: <OnboardingPageShell
			content={
				<div className='flex flex-col items-center gap-8'>
					<div className="text-5xl font-light text-center">Authentication</div>
					<div className="text-lg text-center opacity-80 max-w-md">
						To use Nap IDE, please sign in to your account. This allows you to sync your settings and access agent features.
					</div>

					{authError && (
						<div className="p-3 bg-rose-500/20 border border-rose-500/50 rounded-lg text-rose-200 text-sm">
							{authError}
						</div>
					)}

					<PrimaryActionButton
						onClick={handleLogin}
						disabled={isAuthenticating}
						className={isAuthenticating ? 'opacity-50 cursor-not-allowed' : ''}
					>
						{isAuthenticating ? 'Redirecting...' : 'Sign in to Nap'}
					</PrimaryActionButton>

					<button
						onClick={() => {
							voidSettingsService.setGlobalSetting('isOnboardingComplete', true);
							voidMetricsService.capture('Completed Onboarding', {})
						}}
						className="px-6 py-2 text-void-fg-3 opacity-70 hover:opacity-100 transition-opacity duration-200"
					>
						Sign in later
					</button>

					<div className="text-xs opacity-50 text-center">
						By signing in, you agree to our Terms of Service and Privacy Policy.
					</div>
				</div>
			}
			bottom={
				<div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
					<PreviousButton onClick={() => setPageIndex(0)} />
				</div>
			}
		/>,



	}

	return (
		<div key={pageIndex} className="w-full h-[80vh] text-left mx-auto flex flex-col items-center justify-center">
			<ErrorBoundary>
				{contentOfIdx[pageIndex]}
			</ErrorBoundary>
		</div>
	)
}
