import { createApp } from "./app";
import { config } from "./config";
import { createClient } from "./llm";
import { log } from "./logger";

const client = createClient();
createApp(client).listen(config.port, () => {
  log("info", "server_started", { port: config.port, mode: client.mode, model: client.model });
  if (client.mode === "mock") {
    log("warn", "mock_mode", { message: "No ANTHROPIC_API_KEY set. Using recorded responses." });
  }
});
