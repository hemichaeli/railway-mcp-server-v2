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

// GraphQL queries
const queries = {
  listProjects: gql`query { projects { edges { node { id name description createdAt updatedAt } } } }`,
  getProject: gql`query($id: String!) { project(id: $id) { id name description createdAt services { edges { node { id name } } } environments { edges { node { id name } } } } }`,
  listServices: gql`query($projectId: String!) { project(id: $projectId) { services { edges { node { id name icon createdAt } } } } }`,
  listDeployments: gql`query($projectId: String!, $serviceId: String!) { deployments(projectId: $projectId, serviceId: $serviceId, first: 10) { edges { node { id status createdAt } } } }`,
  getDeploymentLogs: gql`query($deploymentId: String!, $limit: Int) { deploymentLogs(deploymentId: $deploymentId, limit: $limit) { message timestamp severity } }`,
  listVariables: gql`query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) { name value } }`,
  listEnvironments: gql`query($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`,
  createProject: gql`mutation($name: String!, $description: String) { projectCreate(input: { name: $name, description: $description }) { id name } }`,
  createService: gql`mutation($projectId: String!, $name: String!) { serviceCreate(input: { projectId: $projectId, name: $name }) { id name } }`,
  deployFromGithub: gql`mutation($projectId: String!, $repo: String!, $branch: String) { serviceCreate(input: { projectId: $projectId, source: { repo: $repo, branch: $branch } }) { id name } }`,
  createDomain: gql`mutation($serviceId: String!, $environmentId: String!) { serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) { domain } }`,
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
    version: "2.0.0",
  });

  // Register tools
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

  server.tool("list_variables", "List environment variables", {
    projectId: z.string(),
    environmentId: z.string(),
    serviceId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.listVariables, args);
    return { content: [{ type: "text", text: JSON.stringify(data.variables, null, 2) }] };
  });

  server.tool("list_environments", "List environments in a project", { projectId: z.string() }, async ({ projectId }) => {
    const data: any = await client.request(queries.listEnvironments, { projectId });
    return { content: [{ type: "text", text: JSON.stringify(data.project.environments.edges.map((e: any) => e.node), null, 2) }] };
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
    repo: z.string().describe("GitHub repo (user/repo)"),
    branch: z.string().optional()
  }, async (args) => {
    const data: any = await client.request(queries.deployFromGithub, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceCreate, null, 2) }] };
  });

  server.tool("create_domain", "Generate a domain for a service", {
    serviceId: z.string(),
    environmentId: z.string()
  }, async (args) => {
    const data: any = await client.request(queries.createDomain, args);
    return { content: [{ type: "text", text: JSON.stringify(data.serviceDomainCreate, null, 2) }] };
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

app.use(express.json());

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
    await transport.handlePostMessage(req, res, req.body);
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
    version: "2.0.0"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Railway MCP Server",
    version: "2.0.0",
    endpoints: {
      streamableHttp: "/mcp",
      sse: "/sse",
      messages: "/messages",
      health: "/health"
    },
    tools: [
      "list_projects", "get_project", "list_services", "list_deployments",
      "get_deployment_logs", "list_variables", "list_environments",
      "create_project", "create_service", "deploy_from_github", "create_domain",
      "set_variable", "set_variables_bulk", "restart_service",
      "delete_project", "delete_service", "delete_variable"
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Railway MCP Server running on port ${PORT}`);
});
