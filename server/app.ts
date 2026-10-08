import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import Papa from "papaparse";
import { z } from "zod";
import { TARGET_FIELDS, type AnalyzeResponse, type NormalizeResponse, type RawRow } from "../shared/schema";
import { config as defaultConfig, type Config } from "./config";
import type { LlmClient } from "./llm/types";
import { log, totals } from "./logger";
import { analyzeColumns, newStats, normalizeRows, type RunContext } from "./pipeline";

const analyzeBody = z.object({ csv: z.string().min(1) });
const normalizeBody = z.object({
  rows: z.array(z.record(z.string())),
  mapping: z.array(z.object({ source: z.string(), target: z.enum([...TARGET_FIELDS, "ignore"]) })),
});

class UserError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createApp(client: LlmClient, config: Config = defaultConfig) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Every request gets an id that appears in each log line it produces.
  app.use((req, res, next) => {
    const requestId = randomUUID().slice(0, 8);
    const started = Date.now();
    res.locals.requestId = requestId;
    totals.requests += 1;
    res.on("finish", () =>
      log("info", "http_request", {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }),
    );
    next();
  });

  const context = (res: Response): RunContext => ({
    client,
    config,
    requestId: res.locals.requestId,
    stats: newStats(client),
  });

  // Express 4 does not catch errors thrown in async handlers, so wrap them.
  const route =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) =>
      handler(req, res).catch(next);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: client.mode, model: client.model, threshold: config.confidenceThreshold });
  });

  app.get("/api/metrics", (_req, res) => {
    res.json({
      ...totals,
      avgLlmLatencyMs: totals.llmCalls ? Math.round(totals.llmLatencyMs / totals.llmCalls) : 0,
    });
  });

  // The synthetic demo file, so a reviewer can try the app without preparing data.
  app.get("/api/sample", (_req, res) => {
    res.type("text/csv").sendFile(fileURLToPath(new URL("../data/sample_leads.csv", import.meta.url)));
  });

  // Step 1: parse the file and suggest a column mapping.
  app.post(
    "/api/analyze",
    route(async (req, res) => {
      const body = analyzeBody.safeParse(req.body);
      if (!body.success) throw new UserError(400, "Send the file content as text in the csv field.");

      const parsed = Papa.parse<RawRow>(body.data.csv.replace(/^\uFEFF/, ""), {
        header: true,
        skipEmptyLines: "greedy",
      });
      const headers = (parsed.meta.fields ?? []).filter((h) => h.trim() !== "");
      const rows = parsed.data;
      if (headers.length === 0 || rows.length === 0) {
        throw new UserError(400, "The file has no header row or no data rows. Check that it is a CSV file.");
      }
      if (rows.length > config.maxRows) {
        throw new UserError(413, `This file has ${rows.length} rows. The limit is ${config.maxRows}.`);
      }

      const ctx = context(res);
      const mapping = await analyzeColumns(headers, rows, ctx);
      log("info", "analyze_done", { requestId: ctx.requestId, rows: rows.length, columns: headers.length, ...ctx.stats });
      res.json({ rows, mapping, stats: ctx.stats } satisfies AnalyzeResponse);
    }),
  );

  // Step 2: apply the mapping the user confirmed, classify job titles and check each row.
  app.post(
    "/api/normalize",
    route(async (req, res) => {
      const body = normalizeBody.safeParse(req.body);
      if (!body.success) throw new UserError(400, "The request needs rows and a column mapping.");
      if (body.data.rows.length > config.maxRows) throw new UserError(413, "Too many rows.");

      const ctx = context(res);
      const rows = await normalizeRows(body.data.rows, body.data.mapping, ctx);
      log("info", "normalize_done", { requestId: ctx.requestId, rows: rows.length, ...ctx.stats });
      res.json({ rows, threshold: config.confidenceThreshold, stats: ctx.stats } satisfies NormalizeResponse);
    }),
  );

  // Serve the built client when it exists (npm run build && npm start).
  const dist = fileURLToPath(new URL("../client/dist", import.meta.url));
  if (existsSync(dist)) app.use(express.static(dist));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof UserError ? error.status : (error as { status?: number })?.status ?? 500;
    const message =
      error instanceof UserError
        ? error.message
        : status === 413
          ? "The file is too large. The limit is 5 MB."
          : "Something went wrong on the server. Try again, and check the server log if it keeps happening.";
    log("error", "request_failed", {
      requestId: res.locals.requestId,
      status,
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(status).json({ error: message, requestId: res.locals.requestId });
  });

  return app;
}
