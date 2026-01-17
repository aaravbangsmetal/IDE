#!/usr/bin/env node
/**
 * Script to start Opencode server manually
 * Run with: node start-opencode-server.js
 * 
 * Note: This requires the 'opencode' CLI command to be installed.
 * Install it with: npm install -g @opencode-ai/cli
 * Or use: npx opencode serve
 */

import { createOpencode } from '@opencode-ai/sdk';

async function startServer() {
	try {
		console.log('Starting Opencode server...');
		const { client, server } = await createOpencode({
			hostname: '127.0.0.1',
			port: 4096,
			config: {
				tools: {
					webfetch: { enabled: true, requireApproval: false },
					edit: { enabled: true, requireApproval: true },
					write: { enabled: true, requireApproval: true },
					bash: { enabled: true, requireApproval: true }
				},
				network: { allowed: true }
			}
		});
		
		console.log(`Opencode server started at ${server.url}`);
		console.log('Press Ctrl+C to stop the server');
		
		// Keep the process running
		process.on('SIGINT', () => {
			console.log('\nShutting down Opencode server...');
			server.close();
			process.exit(0);
		});
	} catch (error) {
		console.error('Failed to start Opencode server:', error);
		process.exit(1);
	}
}

startServer();
