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

// Store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

// GraphQL queries - Railway API v2
const queries = {
  listProjects: gql`query { projects { edges { node { id name description createdAt updatedAt } } } }`,
  getProject: gql`query($id: String!) { project(id: $id) { id name description createdAt services { edges { node { id name } } } environments { edges { node { id name } } } } }`,
  listServices: gql`query($projectId: String!) { project(id: $projectId) { services { edges { node { id name icon createdAt } } } } }`,
  getService: gql`query($id: String!) { service(id: $id) { id name icon createdAt source { image repo branch } } }`,
  listDeployments: gql`query($projectId: String!, $serviceId: String!) { deployments(input: { projectId: $projectId, serviceId: $serviceId }, first: 10) { edges { node { id status createdAt } } } }`,
  getDeploymentLogs: gql`query($deploymentId: String!, $limit: Int) { deploymentLogs(deploymentId: $deploymentId, limit: $limit) { message timestamp severity } }`,
  cancelDeployment: gql`mutation($id: String!) { deploymentCancel(id: $id) }`,
  listVariables: gql`query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }`,
  listEnvironments: gql`query($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`,
  listDomains: gql`query($serviceId: String!, $environmentId: String!, $projectId: String!) { domains(serviceId: $serviceId, environmentId: $environmentId, projectId: $projectId) { serviceDomains { id domain } customDomains { id domain } } }`,
  createProject: gql`mutation($name: String!, $description: String) { projectCreate(input: { name: $name, description: $description }) { id name } }`,
  createService: gql`mutation($projectId: String!, $name: String!) { serviceCreate(input: { projectId: $projectId, name: $name }) { id name } }`,
  deployFromGithub: gql`mutation($projectId: String!, $repo: String!) { serviceCreate(input: { projectId: $projectId, source: { repo: $repo } }) { id name } }`,
  createDomain: gql`mutation($serviceId: String!, $environmentId: String!) { serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) { domain } }`,
  createCustomDomain: gql`mutation($serviceId: String!, $environmentId: String!, $domain: String!) { customDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId, domain: $domain }) { id domain } }`,
  deleteServiceDomain: gql`mutation($id: String!) { serviceDomainDelete(id: $id) }`,
  setVariable: gql`mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $name: String!, $value: String!) { variableUpsert(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, name: $name, value: $value }) }`,
  restartService: gql`mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
  deleteProject: gql`mutation($id: String!) { projectDelete(id: $id) }`,
  deleteService: gql`mutation($id: String!) { serviceDelete(id: $id) }`,
  deleteVariable: gql`mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $name: String!) { variableDelete(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, name: $name }) }`,
};

// Create and configure MCP server
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "railway-mcp-server",
    version: "2.1.0",
  });

  server.tool("list_projects", "List all Railway projects", {}, async () => {
    const data: any = await client.request(queries.listProjects);
    return { content: [{ type: "text", text: JSON.stringify(data.projects.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_project", "Get project details", { projectId: z.string().describe("Project ID") }, async ({ projectId }) => {
    const data: any = await client.request(queries.getProject, { id: projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project, null, 2) }] };
  });

  server.tool("list_services", "List services in a project", { projectId: z.string().describe("Project ID") }, async ({ projectId }) => {
    const data: any = await client.request(queries.listServices, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project.services.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_service", "Get service details including source repo, branch, and image", {
    serviceId: z.string().describe("Service ID")
  }, async ({ serviceId }) => {
    const data: any = await client.request(queries.getService, { id: serviceId });
    return { content: [{ type: "text", text: JSON.stringify(data.service, null, 2) }] };
  });

  server.tool("list_deployments", "List deployments for a service", {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().describe("Service ID")
  }, async ({ projectId, serviceId }) => {
    const data: any = await client.request(queries.listDeployments, { projectId, serviceId });
    return { content: [{ type: "text", text: JSON.stringify(data.deployments.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("get_deployment_logs", "Get deployment logs", {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().describe("Number of log lines")
  }, async ({ deploymentId, limit }) => {
    const data: any = await client.request(queries.getDeploymentLogs, { deploymentId, limit: limit || 100 });
    return { content: [{ type: "text", text: JSON.stringify(data.deploymentLogs, null, 2) }] };
  });

  server.tool("cancel_deployment", "Cancel an active deployment", {
    deploymentId: z.string().describe("Deployment ID to cancel")
  }, async ({ deploymentId }) => {
    await client.request(queries.cancelDeployment, { id: deploymentId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Deployment cancelled" }, null, 2) }] };
  });

  server.tool("list_variables", "List environment variables", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.listVariables, args);
    const varsObj = data.variables || {};
    const varsArray = Object.entries(varsObj).map(([name, value]) => ({ name, value }));
    return { content: [{ type: "text", text: JSON.stringify(varsArray, null, 2) }] };
  });

  server.tool("list_environments", "List environments in a project", { projectId: z.string() }, async ({ projectId }) => {
    const data: any = await client.request(queries.listEnvironments, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project.environments.edges.map((e: any) => e.node), null, 2) }] };
  });

  server.tool("list_domains", "List all domains (Railway-generated and custom) for a service in an environment", {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    projectId: z.string().describe("Project ID")
  }, async ({ serviceId, environmentId, projectId }) => {
    const data: any = await client.request(queries.listDomains, { serviceId, environmentId, projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.domains, null, 2) }] };
  });

  server.tool("create_project", "Create a new Railway project", {
    name: z.string().describe("Project name"),
    description: z.string().optional().describe("Project description")
  }, async (args) => {
    const data: any = await client.request(queries.createProject, args);
    return { content: [{ type: "text", text: JSON.stringify(data.projectCreate, null, 2) }] };
  });

  server.tool("create_service", "Create a new service in a project", {
    projectId: z.string(),
    name: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.createService, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceCreate, null, 2) }] };
  });

  server.tool("deploy_from_github", "Deploy a service from a GitHub repo", {
    projectId: z.string(),
    repo: z.string().describe("GitHub repo (user/repo)")
  }, async ({ projectId, repo }) => {
    const data: any = await client.request(queries.deployFromGithub, { projectId, repo });
    return { content: [{ type: "text", text: JSON.stringify(data.serviceCreate, null, 2) }] };
  });

  server.tool("create_domain", "Generate a Railway domain for a service", {
    serviceId: z.string(),
    environmentId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.createDomain, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceDomainCreate, null, 2) }] };
  });

  server.tool("create_custom_domain", "Attach a custom domain to a service in an environment", {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    domain: z.string().describe("Custom domain (e.g. api.example.com)")
  }, async (args) => {
    const data: any = await client.request(queries.createCustomDomain, args);
    return { content: [{ type: "text", text: JSON.stringify(data.customDomainCreate, null, 2) }] };
  });

  server.tool("delete_service_domain", "Delete a Railway-generated service domain by its ID", {
    domainId: z.string().describe("Service domain ID (get from list_domains)")
  }, async ({ domainId }) => {
    await client.request(queries.deleteServiceDomain, { id: domainId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Domain deleted" }, null, 2) }] };
  });

  server.tool("set_variable", "Set an environment variable", {
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
    variables: z.record(z.string()).describe("Key-value pairs")
  }, async ({ projectId, environmentId, serviceId, variables }) => {
    const results = [];
    for (const [name, value] of Object.entries(variables)) {
      await client.request(queries.setVariable, { projectId, environmentId, serviceId, name, value });
      results.push({ name, success: true });
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("restart_service", "Restart a service (redeploy)", {
    serviceId: z.string(),
    environmentId: z.string()
  }, async (args) => {
    await client.request(queries.restartService, args);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Service restarting" }, null, 2) }] };
  });

  server.tool("delete_project", "Delete a project", { projectId: z.string() }, async ({ projectId }) => {
    await client.request(queries.deleteProject, { id: projectId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Project deleted" }, null, 2) }] };
  });

  server.tool("delete_service", "Delete a service", { serviceId: z.string() }, async ({ serviceId }) => {
    await client.request(queries.deleteService, { id: serviceId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Service deleted" }, null, 2) }] };
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

  return server;
}

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Apply express.json() only to routes that need it (NOT /messages)
app.use((req, res, next) => {
  if (req.path === "/messages") {
    return next();
  }
  express.json()(req, res, next);
});

// Modern Streamable HTTP transport - POST /mcp
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const isInitRequest = req.body?.method === "initialize";

  try {
    if (isInitRequest) {
      const newSessionId = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });
      
      transports[newSessionId] = transport;
      
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      
      await transport.handleRequest(req, res, req.body);
    } else if (sessionId && transports[sessionId]) {
      const transport = transports[sessionId] as StreamableHTTPServerTransport;
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session" },
        id: req.body?.id || null
      });
    }
  } catch (error) {
    console.error("MCP POST error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body?.id || null
      });
    }
  }
});

// Session cleanup
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  if (sessionId && transports[sessionId]) {
    const transport = transports[sessionId];
    await transport.close?.();
    delete transports[sessionId];
    res.status(204).end();
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

// Legacy SSE transport - GET /sse
app.get("/sse", async (req: Request, res: Response) => {
  console.log("SSE connection request received");
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports[sessionId] = transport;
  
  console.log(`SSE session created: ${sessionId}`);

  const mcpServer = createMcpServer();
  
  transport.onclose = () => {
    console.log(`SSE session closed: ${sessionId}`);
    delete transports[sessionId];
  };

  try {
    await mcpServer.connect(transport);
    console.log(`MCP server connected to SSE session: ${sessionId}`);
  } catch (error) {
    console.error("SSE connection error:", error);
    delete transports[sessionId];
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

// Legacy SSE transport - POST /messages
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`Message received for session: ${sessionId}`);
  
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const transport = transports[sessionId];
  if (!transport || !(transport instanceof SSEServerTransport)) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Message handling error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sessions: Object.keys(transports).length,
    version: "2.1.0"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Railway MCP Server",
    version: "2.1.0",
    endpoints: {
      streamableHttp: "/mcp",
      sse: "/sse",
      messages: "/messages",
      health: "/health"
    },
    tools: [
      "list_projects", "get_project", "list_services", "get_service",
      "list_deployments", "get_deployment_logs", "cancel_deployment",
      "list_variables", "list_environments", "list_domains",
      "create_project", "create_service", "deploy_from_github",
      "create_domain", "create_custom_domain", "delete_service_domain",
      "set_variable", "set_variables_bulk", "restart_service",
      "delete_project", "delete_service", "delete_variable"
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Railway MCP Server v2.1.0 running on port ${PORT}`);
});
