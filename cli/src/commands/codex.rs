/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{
	net::{IpAddr, Ipv4Addr, SocketAddr},
	str::FromStr,
};
use sysinfo::Pid;
use tokio::{
	io::{AsyncRead, AsyncWrite},
	sync::watch,
};

use super::{args::CodexArgs, CommandContext};
use crate::{
	async_pipe::{get_socket_name, listen_socket_rw_stream, AsyncRWAccepter},
	constants::IS_A_TTY,
	log,
	tunnels::shutdown_signal::ShutdownRequest,
	util::errors::{wrap, AnyError, CodeError},
};
use futures::{stream::FuturesUnordered, StreamExt};

/// Runs the Codex agent server, communicating via JSON-RPC over stdin/stdout or a socket/port.
///
/// This command sets up a JSON-RPC server that communicates with the TypeScript IDE process.
/// When codex-rs is integrated, it will spawn and manage the Codex agent engine.
pub async fn command_codex(ctx: CommandContext, args: CodexArgs) -> Result<i32, AnyError> {
	let mut shutdown_reqs = vec![ShutdownRequest::CtrlC];
	if let Some(p) = args.parent_process_id.and_then(|p| Pid::from_str(&p).ok()) {
		shutdown_reqs.push(ShutdownRequest::ParentProcessKilled(p));
	}
	let shutdown = ShutdownRequest::create_rx(shutdown_reqs);

	// TODO: When codex-rs is integrated, initialize Codex here:
	// use codex_core::Codex;
	// let codex = Codex::spawn(...).await?;

	// Set up listener (socket, port, or stdin/stdout)
	let mut listener: Box<dyn AsyncRWAccepter> = match (args.on_port.first(), &args.on_host, args.on_socket) {
		(_, _, true) => {
			let socket = get_socket_name();
			let listener = listen_socket_rw_stream(&socket)
				.await
				.map_err(|e| wrap(e, "error listening on socket"))?;

			ctx.log.result(format!("Codex listening on {}", socket.display()));

			Box::new(listener)
		}
		(Some(_), _, _) | (_, Some(_), _) => {
			let host = args
				.on_host
				.as_ref()
				.map(|h| h.parse().map_err(CodeError::InvalidHostAddress))
				.unwrap_or(Ok(IpAddr::V4(Ipv4Addr::LOCALHOST)))?;

			let port_no = args.on_port.first().copied().unwrap_or_default();
			let addr = SocketAddr::new(host, port_no);
			let listener = tokio::net::TcpListener::bind(addr)
				.await
				.map_err(|e| wrap(e, "error listening on port"))?;

			ctx.log.result(format!("Codex listening on {}", listener.local_addr().unwrap()));

			Box::new(listener)
		}
		_ => {
			// Use stdin/stdout
			if *IS_A_TTY {
				ctx.log.warn("Codex server should not be run in a TTY");
			}
			serve_codex_stream(tokio::io::stdin(), tokio::io::stdout(), ctx, shutdown).await;
			return Ok(0);
		}
	};

	// Accept multiple connections
	let mut servers = FuturesUnordered::new();

	loop {
		tokio::select! {
			Some(_) = servers.next() => {},
			socket = listener.accept_rw() => {
				match socket {
					Ok((read, write)) => {
						let ctx_clone = CommandContext {
							log: ctx.log.clone(),
							paths: ctx.paths.clone(),
							args: ctx.args.clone(),
							http: ctx.http.clone(),
						};
						let shutdown_clone = shutdown.clone();
						servers.push(serve_codex_stream(read, write, ctx_clone, shutdown_clone));
					}
					Err(e) => {
						error!(ctx.log, &format!("Error accepting connection: {e}"));
						return Ok(1);
					}
				}
			},
			_ = shutdown.wait() => {
				// Wait for all servers to finish
				while (servers.next().await).is_some() {}
				return Ok(0);
			}
		}
	}
}

/// Serves Codex JSON-RPC protocol on a read/write stream.
async fn serve_codex_stream<R, W>(
	read: R,
	write: W,
	ctx: CommandContext,
	shutdown: watch::Receiver<()>,
) where
	R: AsyncRead + Unpin + Send + 'static,
	W: AsyncWrite + Unpin + Send + 'static,
{
	use crate::json_rpc::{new_json_rpc, start_json_rpc};
	use crate::rpc::RpcDispatcher;
	use crate::util::sync::Barrier;
	use futures::channel::mpsc;

	// TODO: When codex-rs is integrated, initialize Codex here and pass it as context:
	// use codex_core::Codex;
	// let codex = Codex::spawn(...).await?;
	// let dispatcher = new_json_rpc()
	//     .methods(codex)
	//     .register_async("codex/submit", |op: CodexOp, codex: &Codex| async move {
	//         codex.submit(op).await.map_err(|e| AnyError::from(e))
	//     })
	//     .register_async("codex/next_event", |_: (), codex: &Codex| async move {
	//         codex.next_event().await.map_err(|e| AnyError::from(e))
	//     })
	//     .build();

	// For now, create a placeholder dispatcher
	let dispatcher: RpcDispatcher<_, ()> = new_json_rpc()
		.methods(())
		.register_sync("codex/ping", |_: (), _ctx: &()| {
			Ok(serde_json::json!({"status": "ok", "message": "Codex server is running (placeholder)"}))
		})
		.build();

	// Create a dummy message receiver (not used for now)
	let (_tx, rx) = mpsc::channel(0);

	// Start JSON-RPC server
	let _ = start_json_rpc(dispatcher, read, write, rx, shutdown).await;
}
