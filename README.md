# Railway MCP Server v2

Railway MCP Server using the official `@modelcontextprotocol/sdk` with full support for:
- **Streamable HTTP** transport (modern, recommended)
- **SSE** transport (legacy compatibility)

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | Streamable HTTP transport |
| `/mcp` | DELETE | Session cleanup |
| `/sse` | GET | SSE transport (legacy) |
| `/messages` | POST | SSE messages endpoint |
| `/health` | GET | Health check |

## Tools (17 total)

- `list_projects` - List all Railway projects
- `get_project` - Get project details
- `list_services` - List services in a project
- `list_deployments` - List deployments for a service
- `get_deployment_logs` - Get deployment logs
- `list_variables` - List environment variables
- `list_environments` - List environments in a project
- `create_project` - Create a new Railway project
- `create_service` - Create a new service
- `deploy_from_github` - Deploy from GitHub repo
- `create_domain` - Generate a domain for a service
- `set_variable` - Set an environment variable
- `set_variables_bulk` - Set multiple variables at once
- `restart_service` - Restart a service
- `delete_project` - Delete a project
- `delete_service` - Delete a service
- `delete_variable` - Delete an environment variable

## Environment Variables

- `RAILWAY_API_TOKEN` - Your Railway API token (required)
- `PORT` - Server port (default: 3000)

## Deploy to Railway

1. Create a new project in Railway
2. Connect this GitHub repo
3. Add environment variable: `RAILWAY_API_TOKEN`
4. Deploy!

## Connect to Claude.ai

Use one of these URLs in Claude.ai Connectors:

- **Streamable HTTP**: `https://your-domain.railway.app/mcp`
- **SSE (legacy)**: `https://your-domain.railway.app/sse`
