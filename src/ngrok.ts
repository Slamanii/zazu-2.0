import ngrok from "@ngrok/ngrok";
import { NGROK_AUTHTOKEN } from "./env";

let _serverUrl = "";

export function getServerUrl(): string {
  return _serverUrl;
}

export async function startNgrok(port: number): Promise<string> {
  const listener = await ngrok.forward({
    addr: port,
    authtoken: NGROK_AUTHTOKEN,
  });

  _serverUrl = listener.url()!;
  console.log(`[ngrok] Tunnel active: ${_serverUrl}`);
  return _serverUrl;
}
