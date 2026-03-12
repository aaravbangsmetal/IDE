/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useIsDark } from '../util/services.js';
import { logoBase64 } from './VoidWelcomeData.js';

export const VoidWelcome = () => {
	const isDark = useIsDark();
	const [visible, setVisible] = useState(true);
	const [opacity, setOpacity] = useState(0);

	useEffect(() => {
		// Fade in
		const fadeInTimeout = setTimeout(() => setOpacity(1), 100);

		// Fade out after 2.5s
		const fadeOutTimeout = setTimeout(() => setOpacity(0), 2500);

		// Remove from DOM after 3.5s
		const removeTimeout = setTimeout(() => setVisible(false), 3500);

		return () => {
			clearTimeout(fadeInTimeout);
			clearTimeout(fadeOutTimeout);
			clearTimeout(removeTimeout);
		};
	}, []);

	if (!visible) return null;

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[999999]
					transition-opacity duration-1000 flex items-center justify-center
				`}
				style={{ opacity, height: '100vh', pointerEvents: 'none' }}
			>
				<div className="flex flex-col items-center gap-6">
					<img
						src={logoBase64}
						alt="NapEditor Logo"
						className="max-w-[400px] h-auto"
						style={{ filter: isDark ? '' : 'invert(1)' }}
					/>
				</div>
			</div>
		</div>
	);
};
