use super::AssemblyLab;
use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use std::{env, error::Error, net::Ipv4Addr};
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;

const DEFAULT_PORT: u16 = 8765;
const TOKEN_ENV: &str = "ASSEMBLY_LAB_MCP_TOKEN";

pub async fn serve_http() -> Result<(), Box<dyn Error>> {
    let token = env::var(TOKEN_ENV).unwrap_or_default();
    let token: [u8; 64] = token
        .as_bytes()
        .try_into()
        .map_err(|_| token_format_error())?;
    if !token.iter().all(u8::is_ascii_hexdigit) {
        return Err(token_format_error().into());
    }

    let port = match env::var("ASSEMBLY_LAB_MCP_PORT") {
        Ok(value) => value.parse::<u16>()?,
        Err(env::VarError::NotPresent) => DEFAULT_PORT,
        Err(error) => return Err(error.into()),
    };
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
    let address = listener.local_addr()?;
    let config = StreamableHttpServerConfig::default()
        .enforce_origin_validation()
        .with_max_request_body_bytes(super::MESSAGE_LIMIT as usize)
        .with_json_response(true);
    let service: StreamableHttpService<AssemblyLab, LocalSessionManager> =
        StreamableHttpService::new(|| Ok(AssemblyLab), Default::default(), config);
    let router = Router::new()
        .route_service("/mcp", service)
        .layer(middleware::from_fn_with_state(token, require_bearer));

    eprintln!("Assembly Lab MCP HTTP listening on http://{address}/mcp");
    axum::serve(listener, router).await?;
    Ok(())
}

fn token_format_error() -> &'static str {
    "Set ASSEMBLY_LAB_MCP_TOKEN to 64 hexadecimal characters, generated with openssl rand -hex 32."
}

async fn require_bearer(State(token): State<[u8; 64]>, request: Request, next: Next) -> Response {
    if valid_bearer(request.headers(), &token) {
        return next.run(request).await;
    }
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer")],
    )
        .into_response()
}

fn valid_bearer(headers: &HeaderMap, token: &[u8; 64]) -> bool {
    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let Some(value) = values.next() else {
        return false;
    };
    let Some((scheme, presented)) = value.as_bytes().split_at_checked(7) else {
        return false;
    };
    values.next().is_none()
        && scheme.eq_ignore_ascii_case(b"Bearer ")
        && bool::from(presented.ct_eq(token))
}
