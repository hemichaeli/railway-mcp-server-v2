import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { GraphQLClient, gql } from "graphql-request";
import { randomUUID } from "crypto";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN || "";

const client = new GraphQLClient("https://backboard.railway.app/graphql/v2", {
  headers: { Authorization: `Bearer ${RAILWAY_API_TOKEN}` },
});

const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

const queries = {
  // Projects
  listProjects: gql`query { projects { edges { node { id name description createdAt updatedAt } } } }`,
  getProject: gql`query($id: String!) { project(id: $id) { id name description createdAt services { edges { node { id name } } } environments { edges { node { id name } } } } }`,
  getProjectMembers: gql`query($projectId: String!) { projectMembers(projectId: $projectId) { id name email role avatar } }`,
  createProject: gql`mutation($name: String!, $description: String) { projectCreate(input: { name: $name, description: $description }) { id name } }`,
  deleteProject: gql`mutation($id: String!) { projectDelete(id: $id) }`,

  // Services
  listServices: gql`query($projectId: String!) { project(id: $projectId) { services { edges { node { id name icon createdAt } } } } }`,
  getService: gql`query($id: String!) { service(id: $id) { id name icon createdAt source { image repo branch } } }`,
  createService: gql`mutation($projectId: String!, $name: String!) { serviceCreate(input: { projectId: $projectId, name: $name }) { id name } }`,
  deployFromGithub: gql`mutation($projectId: String!, $repo: String!) { serviceCreate(input: { projectId: $projectId, source: { repo: $repo } }) { id name } }`,
  restartService: gql`mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
  deleteService: gql`mutation($id: String!) { serviceDelete(id: $id) }`,

  // Environments
  listEnvironments: gql`query($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`,
  createEnvironment: gql`mutation($projectId: String!, $name: String!) { environmentCreate(input: { projectId: $projectId, name: $name }) { id name } }`,
  deleteEnvironment: gql`mutation($id: String!) { environmentDelete(id: $id) }`,

  // Deployments
  listDeployments: gql`query($projectId: String!, $serviceId: String!) { deployments(input: { projectId: $projectId, serviceId: $serviceId }, first: 10) { edges { node { id status createdAt url staticUrl } } } }`,
  getDeployment: gql`query($id: String!) { deployment(id: $id) { id status url staticUrl environmentId serviceId projectId createdAt updatedAt canRedeploy canRollback meta } }`,
  cancelDeployment: gql`mutation($id: String!) { deploymentCancel(id: $id) }`,

  // Logs
  getDeploymentLogs: gql`query($deploymentId: String!, $limit: Int) { deploymentLogs(deploymentId: $deploymentId, limit: $limit) { message timestamp severity } }`,
  getBuildLogs: gql`query($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { message timestamp severity } }`,
  getEnvironmentLogs: gql`query($environmentId: String!, $beforeLimit: Int) { environmentLogs(environmentId: $environmentId, beforeLimit: $beforeLimit) { message timestamp severity } }`,
  getHttpLogs: gql`query($deploymentId: String!, $limit: Int) { httpLogs(deploymentId: $deploymentId, limit: $limit) { timestamp method path httpStatus host srcIp totalDuration txBytes rxBytes } }`,

  // Deployment snapshot
  getDeploymentSnapshot: gql`query($deploymentId: String!) { deploymentSnapshot(deploymentId: $deploymentId) { id variables createdAt updatedAt } }`,

  // Variables
  listVariables: gql`query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }`,
  setVariable: gql`mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $name: String!, $value: String!) { variableUpsert(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, name: $name, value: $value }) }`,
  deleteVariable: gql`mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $name: String!) { variableDelete(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, name: $name }) }`,

  // Domains
  listDomains: gql`query($serviceId: String!, $environmentId: String!, $projectId: String!) { domains(serviceId: $serviceId, environmentId: $environmentId, projectId: $projectId) { serviceDomains { id domain } customDomains { id domain } } }`,
  createDomain: gql`mutation($serviceId: String!, $environmentId: String!) { serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) { domain } }`,
  createCustomDomain: gql`mutation($serviceId: String!, $environmentId: String!, $domain: String!) { customDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId, domain: $domain }) { id domain } }`,
  deleteServiceDomain: gql`mutation($id: String!) { serviceDomainDelete(id: $id) }`,

  // Account / Platform
  getMe: gql`query { me { id name email username createdAt isAdmin } }`,
  platformStatus: gql`query { platformStatus { isStable } }`,
  getGithubRepos: gql`query { githubRepos { id name fullName defaultBranch isPrivate } }`,
  getEstimatedUsage: gql`query($projectId: String, $measurements: [MetricMeasurement!]!) { estimatedUsage(projectId: $projectId, measurements: $measurements) { measurement estimatedValue projectId } }`,
};

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "railway-mcp-server", version: "2.2.0" });

  // ── Projects ──────────────────────────────────────────────────────────────

  server.tool("list_projects", "List all Railway projects", {}, async () => {
    const data: any = await client.request(queries.listProjects);
    return { content: [{ type: "text", text: JSON.stringify(data.projects.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_project", "Get project details including services and environments", {
    projectId: z.string().describe("Project ID")
  }, async ({ projectId }) => {
    const data: any = await client.request(queries.getProject, { id: projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project, null, 2) }] };
  });

  server.tool("get_project_members", "List all members of a project with their roles", {
    projectId: z.string().describe("Project ID")
  }, async ({ projectId }) => {
    const data: any = await client.request(queries.getProjectMembers, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.projectMembers, null, 2) }] };
  });

  server.tool("create_project", "Create a new Railway project", {
    name: z.string().describe("Project name"),
    description: z.string().optional().describe("Project description")
  }, async (args) => {
    const data: any = await client.request(queries.createProject, args);
    return { content: [{ type: "text", text: JSON.stringify(data.projectCreate, null, 2) }] };
  });

  server.tool("delete_project", "Delete a project", {
    projectId: z.string().describe("Project ID")
  }, async ({ projectId }) => {
    await client.request(queries.deleteProject, { id: projectId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Project deleted" }, null, 2) }] };
  });

  // ── Services ─────────────────────────────────────────────────────────────

  server.tool("list_services", "List services in a project", {
    projectId: z.string().describe("Project ID")
  }, async ({ projectId }) => {
    const data: any = await client.request(queries.listServices, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project.services.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_service", "Get service details including source repo, branch, and image", {
    serviceId: z.string().describe("Service ID")
  }, async ({ serviceId }) => {
    const data: any = await client.request(queries.getService, { id: serviceId });
    return { content: [{ type: "text", text: JSON.stringify(data.service, null, 2) }] };
  });

  server.tool("create_service", "Create a new empty service in a project", {
    projectId: z.string(),
    name: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.createService, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceCreate, null, 2) }] };
  });

  server.tool("deploy_from_github", "Deploy a service from a GitHub repo", {
    projectId: z.string(),
    repo: z.string().describe("GitHub repo in owner/repo format")
  }, async ({ projectId, repo }) => {
    const data: any = await client.request(queries.deployFromGithub, { projectId, repo });
    return { content: [{ type: "text", text: JSON.stringify(data.serviceCreate, null, 2) }] };
  });

  server.tool("restart_service", "Restart a service (triggers a redeploy)", {
    serviceId: z.string(),
    environmentId: z.string()
  }, async (args) => {
    await client.request(queries.restartService, args);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Service restarting" }, null, 2) }] };
  });

  server.tool("delete_service", "Delete a service", {
    serviceId: z.string()
  }, async ({ serviceId }) => {
    await client.request(queries.deleteService, { id: serviceId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Service deleted" }, null, 2) }] };
  });

  // ── Environments ─────────────────────────────────────────────────────────

  server.tool("list_environments", "List environments in a project", {
    projectId: z.string()
  }, async ({ projectId }) => {
    const data: any = await client.request(queries.listEnvironments, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project.environments.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("create_environment", "Create a new environment in a project", {
    projectId: z.string().describe("Project ID"),
    name: z.string().describe("Environment name (e.g. staging, preview)")
  }, async (args) => {
    const data: any = await client.request(queries.createEnvironment, args);
    return { content: [{ type: "text", text: JSON.stringify(data.environmentCreate, null, 2) }] };
  });

  server.tool("delete_environment", "Delete an environment", {
    environmentId: z.string().describe("Environment ID")
  }, async ({ environmentId }) => {
    await client.request(queries.deleteEnvironment, { id: environmentId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Environment deleted" }, null, 2) }] };
  });

  // ── Deployments ───────────────────────────────────────────────────────────

  server.tool("list_deployments", "List recent deployments for a service (includes URL and status)", {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().describe("Service ID")
  }, async ({ projectId, serviceId }) => {
    const data: any = await client.request(queries.listDeployments, { projectId, serviceId });
    return { content: [{ type: "text", text: JSON.stringify(data.deployments.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_deployment", "Get full details for a single deployment including URL, status, canRollback, and meta", {
    deploymentId: z.string().describe("Deployment ID")
  }, async ({ deploymentId }) => {
    const data: any = await client.request(queries.getDeployment, { id: deploymentId });
    return { content: [{ type: "text", text: JSON.stringify(data.deployment, null, 2) }] };
  });

  server.tool("cancel_deployment", "Cancel an active/pending deployment", {
    deploymentId: z.string().describe("Deployment ID to cancel")
  }, async ({ deploymentId }) => {
    await client.request(queries.cancelDeployment, { id: deploymentId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Deployment cancelled" }, null, 2) }] };
  });

  server.tool("get_deployment_snapshot", "Get the env vars snapshot that was used for a specific deployment", {
    deploymentId: z.string().describe("Deployment ID")
  }, async ({ deploymentId }) => {
    const data: any = await client.request(queries.getDeploymentSnapshot, { deploymentId });
    return { content: [{ type: "text", text: JSON.stringify(data.deploymentSnapshot, null, 2) }] };
  });

  // ── Logs ─────────────────────────────────────────────────────────────────

  server.tool("get_deployment_logs", "Get runtime logs for a deployment", {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().describe("Number of log lines (default 100)")
  }, async ({ deploymentId, limit }) => {
    const data: any = await client.request(queries.getDeploymentLogs, { deploymentId, limit: limit || 100 });
    return { content: [{ type: "text", text: JSON.stringify(data.deploymentLogs, null, 2) }] };
  });

  server.tool("get_build_logs", "Get build-phase logs for a deployment (separate from runtime logs)", {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().describe("Number of log lines (default 100)")
  }, async ({ deploymentId, limit }) => {
    const data: any = await client.request(queries.getBuildLogs, { deploymentId, limit: limit || 100 });
    return { content: [{ type: "text", text: JSON.stringify(data.buildLogs, null, 2) }] };
  });

  server.tool("get_environment_logs", "Get all logs across an entire environment (all services)", {
    environmentId: z.string().describe("Environment ID"),
    limit: z.number().optional().describe("Number of log lines (default 100)")
  }, async ({ environmentId, limit }) => {
    const data: any = await client.request(queries.getEnvironmentLogs, { environmentId, beforeLimit: limit || 100 });
    return { content: [{ type: "text", text: JSON.stringify(data.environmentLogs, null, 2) }] };
  });

  server.tool("get_http_logs", "Get HTTP request logs for a deployment (method, path, status, duration, bytes)", {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().describe("Number of log lines (default 100)")
  }, async ({ deploymentId, limit }) => {
    const data: any = await client.request(queries.getHttpLogs, { deploymentId, limit: limit || 100 });
    return { content: [{ type: "text", text: JSON.stringify(data.httpLogs, null, 2) }] };
  });

  // ── Variables ────────────────────────────────────────────────────────────

  server.tool("list_variables", "List environment variables for a service", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.listVariables, args);
    const varsObj = data.variables || {};
    const varsArray = Object.entries(varsObj).map(([name, value]) => ({ name, value }));
    return { content: [{ type: "text", text: JSON.stringify(varsArray, null, 2) }] };
  });

  server.tool("set_variable", "Set a single environment variable", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string(),
    name: z.string(),
    value: z.string()
  }, async (args) => {
    await client.request(queries.setVariable, args);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, name: args.name }, null, 2) }] };
  });

  server.tool("set_variables_bulk", "Set multiple environment variables at once", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string(),
    variables: z.record(z.string()).describe("Key-value pairs to set")
  }, async ({ projectId, environmentId, serviceId, variables }) => {
    const results = [];
    for (const [name, value] of Object.entries(variables)) {
      await client.request(queries.setVariable, { projectId, environmentId, serviceId, name, value });
      results.push({ name, success: true });
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("delete_variable", "Delete an environment variable", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string(),
    name: z.string()
  }, async (args) => {
    await client.request(queries.deleteVariable, args);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, name: args.name }, null, 2) }] };
  });

  // ── Domains ───────────────────────────────────────────────────────────────

  server.tool("list_domains", "List all domains (Railway-generated and custom) for a service", {
    serviceId: z.string(),
    environmentId: z.string(),
    projectId: z.string()
  }, async ({ serviceId, environmentId, projectId }) => {
    const data: any = await client.request(queries.listDomains, { serviceId, environmentId, projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.domains, null, 2) }] };
  });

  server.tool("create_domain", "Generate a Railway .up.railway.app domain for a service", {
    serviceId: z.string(),
    environmentId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.createDomain, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceDomainCreate, null, 2) }] };
  });

  server.tool("create_custom_domain", "Attach a custom domain to a service", {
    serviceId: z.string(),
    environmentId: z.string(),
    domain: z.string().describe("Custom domain e.g. api.example.com")
  }, async (args) => {
    const data: any = await client.request(queries.createCustomDomain, args);
    return { content: [{ type: "text", text: JSON.stringify(data.customDomainCreate, null, 2) }] };
  });

  server.tool("delete_service_domain", "Delete a Railway-generated service domain by ID (get ID from list_domains)", {
    domainId: z.string().describe("Service domain ID")
  }, async ({ domainId }) => {
    await client.request(queries.deleteServiceDomain, { id: domainId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Domain deleted" }, null, 2) }] };
  });

  // ── Account / Platform ────────────────────────────────────────────────────

  server.tool("get_me", "Get info about the authenticated Railway account", {}, async () => {
    const data: any = await client.request(queries.getMe);
    return { content: [{ type: "text", text: JSON.stringify(data.me, null, 2) }] };
  });

  server.tool("platform_status", "Check if Railway platform is stable or has active incidents", {}, async () => {
    const data: any = await client.request(queries.platformStatus);
    return { content: [{ type: "text", text: JSON.stringify(data.platformStatus, null, 2) }] };
  });

  server.tool("get_github_repos", "List GitHub repos that Railway has access to for deployments", {}, async () => {
    const data: any = await client.request(queries.getGithubRepos);
    return { content: [{ type: "text", text: JSON.stringify(data.githubRepos, null, 2) }] };
  });

  server.tool("get_estimated_usage", "Get estimated cost for the current billing cycle for a project", {
    projectId: z.string().optional().describe("Project ID (omit for account-wide usage)"),
    measurements: z.array(z.enum([
      "CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB", "NETWORK_RX_GB",
      "DISK_USAGE_GB", "BUILD_DURATION_MINUTES"
    ])).optional().describe("Measurements to include (default: CPU, Memory, Network)")
  }, async ({ projectId, measurements }) => {
    const m = measurements || ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB"];
    const data: any = await client.request(queries.getEstimatedUsage, { projectId, measurements: m });
    return { content: [{ type: "text", text: JSON.stringify(data.estimatedUsage, null, 2) }] };
  });

  return server;
}

// ── Express setup ─────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use((req, res, next) => {
  if (req.path === "/messages") return next();
  express.json()(req, res, next);
});

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const isInitRequest = req.body?.method === "initialize";
  try {
    if (isInitRequest) {
      const newSessionId = randomUUID();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => newSessionId });
      transports[newSessionId] = transport;
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else if (sessionId && transports[sessionId]) {
      await (transports[sessionId] as StreamableHTTPServerTransport).handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session" }, id: req.body?.id || null });
    }
  } catch (error) {
    console.error("MCP POST error:", error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: req.body?.id || null });
  }
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].close?.();
    delete transports[sessionId];
    res.status(204).end();
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

app.get("/sse", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports[sessionId] = transport;
  const mcpServer = createMcpServer();
  transport.onclose = () => { delete transports[sessionId]; };
  try {
    await mcpServer.connect(transport);
  } catch (error) {
    delete transports[sessionId];
    if (!res.headersSent) res.status(500).end();
  }
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  const transport = transports[sessionId];
  if (!transport || !(transport instanceof SSEServerTransport)) return res.status(404).json({ error: "Session not found" });
  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", sessions: Object.keys(transports).length, version: "2.2.0" }));

app.get("/", (req, res) => res.json({
  name: "Railway MCP Server",
  version: "2.2.0",
  toolCount: 34,
  tools: [
    // Projects
    "list_projects", "get_project", "get_project_members", "create_project", "delete_project",
    // Services
    "list_services", "get_service", "create_service", "deploy_from_github", "restart_service", "delete_service",
    // Environments
    "list_environments", "create_environment", "delete_environment",
    // Deployments
    "list_deployments", "get_deployment", "cancel_deployment", "get_deployment_snapshot",
    // Logs
    "get_deployment_logs", "get_build_logs", "get_environment_logs", "get_http_logs",
    // Variables
    "list_variables", "set_variable", "set_variables_bulk", "delete_variable",
    // Domains
    "list_domains", "create_domain", "create_custom_domain", "delete_service_domain",
    // Account / Platform
    "get_me", "platform_status", "get_github_repos", "get_estimated_usage"
  ]
}));

app.listen(PORT, () => console.log(`Railway MCP Server v2.2.0 running on port ${PORT} - 34 tools`));
