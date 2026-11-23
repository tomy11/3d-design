use rmcp::{
    handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool, tool_handler,
    tool_router, transport::stdio, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, DirBuilder, OpenOptions},
    io,
    os::unix::fs::{DirBuilderExt, FileTypeExt, PermissionsExt},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager, State, WebviewWindow};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::{oneshot, Semaphore},
    time::timeout,
};

mod http;
pub use self::http::serve_http;

const MESSAGE_LIMIT: u64 = 16 * 1024;
const REPLY_LIMIT: u64 = 64 * 1024;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(45);
const SOCKET_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Serialize, Deserialize)]
pub struct Failure {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
}

impl Failure {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            revision: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BridgeCall {
    name: String,
    arguments: Value,
}

#[derive(Clone, Serialize)]
pub struct BridgeRequest {
    id: String,
    call: BridgeCall,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", content = "data", rename_all = "snake_case")]
pub enum BridgeReply {
    Ok(Value),
    Error(Failure),
}

#[derive(Default)]
pub struct Bridge {
    next_id: AtomicU64,
    frontend: Mutex<Option<Channel<BridgeRequest>>>,
    pending: Mutex<HashMap<String, oneshot::Sender<BridgeReply>>>,
}

#[tauri::command]
pub fn mcp_connect(
    window: WebviewWindow,
    state: State<'_, Bridge>,
    channel: Channel<BridgeRequest>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("The MCP bridge belongs to the main workbench window.".into());
    }
    *state.frontend.lock().unwrap() = Some(channel);
    Ok(())
}

#[tauri::command]
pub fn mcp_reply(window: WebviewWindow, state: State<'_, Bridge>, id: String, reply: BridgeReply) {
    if window.label() == "main" {
        if let Some(send) = state.pending.lock().unwrap().remove(&id) {
            let _ = send.send(reply);
        }
    }
}

impl Bridge {
    async fn dispatch(&self, call: BridgeCall) -> BridgeReply {
        let Some(channel) = self.frontend.lock().unwrap().clone() else {
            return BridgeReply::Error(Failure::new(
                "APP_STARTING",
                "Wait for the Assembly Lab workbench to finish loading.",
            ));
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (send, receive) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), send);
        let result = match channel.send(BridgeRequest { id: id.clone(), call }) {
            Ok(()) => match timeout(BRIDGE_TIMEOUT, receive).await {
                Ok(Ok(reply)) => reply,
                _ => BridgeReply::Error(Failure::new(
                    "BRIDGE_TIMEOUT",
                    "The workbench did not reply in time. Read the current body before retrying an edit.",
                )),
            },
            Err(_) => BridgeReply::Error(Failure::new("APP_UNAVAILABLE", "Open the Assembly Lab workbench.")),
        };
        self.pending.lock().unwrap().remove(&id);
        result
    }
}

fn bridge_dir() -> io::Result<PathBuf> {
    let home =
        std::env::home_dir().ok_or_else(|| io::Error::other("Home directory unavailable"))?;
    let dir = home.join(".assembly-lab");
    match DirBuilder::new().mode(0o700).create(&dir) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(&dir)?;
    if !metadata.is_dir() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "MCP requires a private ~/.assembly-lab directory",
        ));
    }
    Ok(dir)
}

pub fn start_bridge(app: &tauri::App) {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_bridge(handle).await {
            eprintln!("Assembly Lab MCP bridge: {error}");
        }
    });
}

async fn run_bridge(app: tauri::AppHandle) -> io::Result<()> {
    let dir = bridge_dir()?;
    let guard = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("mcp.lock"))?;
    guard.try_lock().map_err(|error| {
        io::Error::other(format!(
            "Another Assembly Lab window owns the bridge, or the lock failed: {error}"
        ))
    })?;
    let path = dir.join("mcp.sock");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_socket() => fs::remove_file(&path)?,
        Ok(_) => return Err(io::Error::other("Unexpected file at the MCP socket path")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let listener = UnixListener::bind(path)?;
    let slots = std::sync::Arc::new(Semaphore::new(8));
    loop {
        let slot = slots
            .clone()
            .acquire_owned()
            .await
            .expect("bridge semaphore stays open");
        let (mut connection, _) = listener.accept().await?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _slot = slot;
            let _ = serve_connection(&mut connection, app.state::<Bridge>().inner()).await;
        });
    }
}

async fn read_message<T: serde::de::DeserializeOwned>(
    connection: &mut UnixStream,
    limit: u64,
) -> io::Result<T> {
    let mut bytes = Vec::new();
    connection.take(limit + 1).read_to_end(&mut bytes).await?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MCP bridge message too large",
        ));
    }
    serde_json::from_slice(&bytes).map_err(io::Error::other)
}

async fn write_message(connection: &mut UnixStream, message: &impl Serialize) -> io::Result<()> {
    let bytes = serde_json::to_vec(message)?;
    connection.write_all(&bytes).await?;
    connection.shutdown().await
}

async fn serve_connection(connection: &mut UnixStream, bridge: &Bridge) -> io::Result<()> {
    let call = timeout(
        SOCKET_TIMEOUT,
        read_message::<BridgeCall>(connection, MESSAGE_LIMIT),
    )
    .await??;
    let reply = bridge.dispatch(call).await;
    timeout(SOCKET_TIMEOUT, write_message(connection, &reply)).await?
}

async fn call_bridge(call: BridgeCall) -> BridgeReply {
    let transport = async {
        let mut connection = UnixStream::connect(bridge_dir()?.join("mcp.sock")).await?;
        write_message(&mut connection, &call).await?;
        read_message(&mut connection, REPLY_LIMIT).await
    };
    match timeout(BRIDGE_TIMEOUT + SOCKET_TIMEOUT, transport).await {
        Ok(Ok(reply)) => reply,
        Ok(Err(_)) => BridgeReply::Error(Failure::new(
            "APP_UNAVAILABLE",
            "Open the Assembly Lab desktop app and wait for the workbench.",
        )),
        Err(_) => BridgeReply::Error(Failure::new(
            "BRIDGE_TIMEOUT",
            "Read the current body before retrying an edit.",
        )),
    }
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct BodyArgs {
    #[schemars(description = "Body ID. Defaults to flange-adapter.")]
    id: Option<String>,
}

#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct EditArgs {
    #[schemars(description = "Body ID returned by get_body.")]
    id: String,
    #[schemars(description = "Project session ID returned by get_body.")]
    project_id: String,
    #[schemars(description = "Current adapter revision returned by get_body.")]
    expected_revision: u64,
    #[schemars(schema_with = "dimension_patch_schema")]
    dimensions: Value,
}

fn dimension_patch_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({
        "type": "object",
        "description": "Send only the dimensions to change. Lengths are in millimetres.",
        "additionalProperties": false,
        "properties": {
            "diameter": { "type": "number", "description": "Outside diameter" },
            "thickness": { "type": "number", "description": "Plate thickness" },
            "bore": { "type": "number", "description": "Center bore diameter" },
            "pitch": { "type": "number", "description": "Bolt circle diameter" },
            "hole": { "type": "number", "description": "Bolt hole diameter" },
            "count": { "type": "integer", "description": "Number of bolt holes" }
        }
    })
}

struct AssemblyLab;

#[tool_router]
impl AssemblyLab {
    #[tool(
        description = "List Assembly Lab scene objects with stable IDs, logical parents, visibility and the active workspace. Service mode parts are illustrative concept components.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn get_scene(&self) -> CallToolResult {
        call_tool("get_scene", json!({})).await
    }

    #[tool(
        description = "Read the current simulated UR10e pose, including J1–J6 in degrees and the tool center point in robot-base coordinates. Pick & Place reports the gripper TCP.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn get_robot_pose(&self) -> CallToolResult {
        call_tool("get_robot_pose", json!({})).await
    }

    #[tool(
        description = "Read the committed dimensions, units, revision and project session ID of the flange adapter in the open Assembly Lab workbench.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn get_body(&self, Parameters(args): Parameters<BodyArgs>) -> CallToolResult {
        let arguments = args.id.map_or_else(|| json!({}), |id| json!({"id": id}));
        call_tool("get_body", arguments).await
    }

    #[tool(
        description = "Update the flange adapter in the open Assembly Lab project. Read get_body first, then pass its project_id and revision with only the dimensions to change. A successful edit is one Undo step.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn set_adapter_dimensions(
        &self,
        Parameters(args): Parameters<EditArgs>,
    ) -> CallToolResult {
        call_tool("set_adapter_dimensions", json!(args)).await
    }
}

async fn call_tool(name: &str, arguments: Value) -> CallToolResult {
    match call_bridge(BridgeCall {
        name: name.into(),
        arguments,
    })
    .await
    {
        BridgeReply::Ok(body) => CallToolResult::structured(body),
        BridgeReply::Error(failure) => CallToolResult::structured_error(json!(failure)),
    }
}

#[tool_handler(
    name = "assembly-lab",
    instructions = "Open the Assembly Lab desktop workbench before calling these tools. Read get_body before editing."
)]
impl ServerHandler for AssemblyLab {}

pub async fn serve_stdio() -> Result<(), Box<dyn std::error::Error>> {
    AssemblyLab.serve(stdio()).await?.waiting().await?;
    Ok(())
}
