/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { Session, Message, Part } from '@opencode-ai/sdk';

export type OpencodeSession = Session;
export type OpencodeMessage = Message;
export type OpencodePart = Part;

export interface OpencodeSessionInfo {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	isActive: boolean;
}

export interface OpencodeEvent {
	type: string;
	properties: Record<string, any>;
}

export interface OpencodeConfig {
	hostname?: string;
	port?: number;
	baseUrl?: string;
	workspaceDir?: string;
}

export interface OpencodeToolCall {
	name: string;
	params: Record<string, any>;
	result?: any;
	status: 'pending' | 'running' | 'completed' | 'error';
	error?: string;
}

export interface OpencodePermission {
	id: string;
	type: 'edits' | 'terminal' | 'MCP tools';
	action: string;
	approved: boolean | null; // null = pending
}
