#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadAcceptanceConfig } from './config.mjs';
import { createAcceptanceConsumer, keepConnected } from './consumer.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c', default: 'tools/browser-client-acceptance/config.json' },
    state: { type: 'string', short: 's' },
    'user-id': { type: 'string' },
    'user-token': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || positionals.length !== 1 || !['enroll', 'connect'].includes(positionals[0])) {
  printUsage();
  process.exit(values.help ? 0 : 1);
}

const command = positionals[0];
const abortController = new AbortController();
let client;
let runtime;
let shuttingDown = false;

try {
  const config = await loadAcceptanceConfig(values.config, values.state);
  ({ client, runtime } = createAcceptanceConsumer(config, runtimeEvents()));

  if (command === 'enroll') {
    const userId = values['user-id'] ?? process.env.COMICCRAWLER_USER_ID;
    const userToken = values['user-token'] ?? process.env.COMICCRAWLER_USER_TOKEN;
    const credentials = userId && userToken ? { userId, userToken } : undefined;
    if ((userId && !userToken) || (!userId && userToken)) {
      throw new Error('User ID and user token must be provided together.');
    }
    const state = await client.enroll({ name: config.clientName, credentials });
    console.log(`Browser Client enrolled: ${state.clientId}`);
    console.log(`Credential ID: ${state.credentialId}`);
    console.log(`State written to: ${config.statePath}`);
    await client.close();
  } else {
    installSignalHandlers();
    console.log(`Connecting Browser Client to ${config.serverUrl}`);
    console.log(`State: ${config.statePath}`);
    console.log(`Execution mode: ${config.executionMode}`);
    console.log(`Profile mode: ${config.browser.profile.type}`);
    await runtime.start(abortController.signal);
    await keepConnected(client, {
      reconnectDelayMs: config.reconnectDelayMs,
      signal: abortController.signal,
      onConnected: (connection) => {
        console.log(`Browser Worker online: ${connection.workerId}`);
        console.log(connectionHint(config.executionMode));
      },
      onDisconnected: (workerId) => console.warn(`Browser Worker disconnected: ${workerId}; reconnecting.`),
      onConnectionError: (error) => console.warn(`Connection failed: ${messageOf(error)}; retrying.`),
    });
    await closeClient();
  }
} catch (error) {
  console.error(messageOf(error));
  await closeClient();
  process.exitCode = 1;
}

function installSignalHandlers() {
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Stopping Browser Client...');
    abortController.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function closeClient() {
  await client?.close().catch((error) => console.warn(`Browser Client cleanup failed: ${messageOf(error)}`));
  await runtime?.close().catch((error) => console.warn(`Browser runtime cleanup failed: ${messageOf(error)}`));
}

function runtimeEvents() {
  return {
    onRegistered: (resource) => console.log(`Tab registered: ${resource.title ?? '(untitled)'} ${resource.url}`),
    onRevoked: (resource) => console.log(`Tab revoked: ${resource.url}`),
    onError: (error) => console.warn(`Tab synchronization failed: ${messageOf(error)}`),
  };
}

function connectionHint(mode) {
  return mode === 'existing-tab'
    ? 'Open the target page in this Chrome, then select the registered tab in Adapter Lab.'
    : 'Create a managed-profile task for this Worker from WebUI or REST.';
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function printUsage() {
  console.log(`Usage:
  npm run acceptance:browser-client -- enroll --config <path> [--state <path>]
  npm run acceptance:browser-client -- connect --config <path> [--state <path>]

Enrollment credentials:
  --user-id <id>       or COMICCRAWLER_USER_ID
  --user-token <token> or COMICCRAWLER_USER_TOKEN

The state file contains the Browser Client credential. Do not commit it.`);
}
