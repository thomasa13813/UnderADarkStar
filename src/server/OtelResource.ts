import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ServerEnv } from "./ServerEnv";

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "darkstar",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  const workerId = ServerEnv.workerId();
  return {
    "service.instance.id": ServerEnv.hostname(),
    "darkstar.environment": ServerEnv.env(),
    "darkstar.host": ServerEnv.host(),
    "darkstar.domain": ServerEnv.domain(),
    "darkstar.subdomain": ServerEnv.subdomain(),
    "darkstar.component":
      workerId !== undefined ? "Worker " + workerId : "Master",
  };
}
