import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { JsonValueSchema, type Project, type JsonValue } from '@udi/contracts';
import type { DaemonClient } from '@udi/client-sdk';

/** Native extension provider for Spec 2's daemon-mediated bridge; never opens a server. */
export function startMcpExtensionBridge(
  current: () => { project: Project; origin: string; client: Promise<DaemonClient> } | undefined,
): vscode.Disposable {
  const hostId = randomUUID();
  let busy = false,
    stopped = false;
  let allowed: string[] = [];
  const tick = async () => {
    const state = current();
    if (stopped || busy || !state || typeof vscode.commands.getCommands !== 'function') return;
    busy = true;
    try {
      const api = await state.client;
      // Re-registering refreshes the daemon's lease after a restart as well as normal use.
      const commands = await vscode.commands.getCommands(true);
      allowed = [
        'vscode.executeDocumentSymbolProvider',
        'editor.action.formatDocument',
        'platformio-ide.build',
        'kicad.inspectNetlist',
      ].filter((c) => commands.includes(c));
      for (const name of ['vscode_execute_command', 'vscode_list_diagnostics'] as const)
        await api.registerHostExtensionTool({
          projectId: state.project.id,
          hostId,
          name,
          description: `Live VS Code ${name}`,
          commandIds: name === 'vscode_execute_command' ? allowed : [],
        });
      const { items } = await api.pollHostExtensionRequests(state.project.id, hostId);
      for (const call of items) {
        let isError = false,
          content: JsonValue;
        try {
          if (
            stopped ||
            current()?.project.id !== state.project.id ||
            current()?.origin !== state.origin ||
            Date.now() >= Date.parse(call.expiresAt)
          )
            throw new Error('Bridge request expired or project changed');
          if (call.name === 'vscode_list_diagnostics') {
            content = vscode.languages
              .getDiagnostics()
              .filter(
                ([uri]) =>
                  vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath === state.project.rootPath,
              )
              .flatMap(([uri, ds]) =>
                ds.map((d) => ({
                  filePath: vscode.workspace.asRelativePath(uri),
                  line: d.range.start.line + 1,
                  column: d.range.start.character + 1,
                  message: d.message,
                  severity: d.severity,
                  source: d.source ?? '',
                })),
              )
              .slice(0, 100);
          } else {
            const commandId = call.arguments.commandId;
            if (typeof commandId !== 'string' || !allowed.includes(commandId))
              throw new Error('Command not allowlisted');
            const approved = await vscode.window.showWarningMessage(
              `MCP agent requests ${commandId} in ${state.project.name}. Review the active editor and project before running.`,
              { modal: true },
              'Approve command',
            );
            if (
              approved !== 'Approve command' ||
              stopped ||
              current()?.project.id !== state.project.id ||
              current()?.origin !== state.origin ||
              Date.now() >= Date.parse(call.expiresAt)
            )
              throw new Error('Command not approved or request expired');
            if (
              !(await api.getToolCategories(state.project.id)).categories.some(
                (c) => c.category === 'ide_extension_bridge' && c.enabled,
              )
            )
              throw new Error('Bridge category disabled');
            const args = Array.isArray(call.arguments.args) ? call.arguments.args : [];
            if (args.length)
              throw new Error('This provider accepts no arbitrary command arguments');
            const active = vscode.window.activeTextEditor?.document.uri;
            if (
              !active ||
              vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath !== state.project.rootPath
            )
              throw new Error('Active editor is outside the selected project');
            // Convert document-symbol paths to an in-workspace URI instead of accepting arbitrary URIs.
            if (commandId === 'vscode.executeDocumentSymbolProvider') {
              const uri = vscode.window.activeTextEditor?.document.uri;
              if (
                !uri ||
                vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath !== state.project.rootPath
              )
                throw new Error('No active editor in the selected project');
              content = JsonValueSchema.parse(
                JSON.parse(
                  JSON.stringify((await vscode.commands.executeCommand(commandId, uri)) ?? null),
                ),
              );
            } else
              content = JsonValueSchema.parse(
                JSON.parse(
                  JSON.stringify(
                    (await vscode.commands.executeCommand(commandId, ...args)) ?? null,
                  ),
                ),
              );
          }
          if (JSON.stringify(content).length > 24000)
            throw new Error('Extension result exceeds bridge limit');
        } catch {
          isError = true;
          content = 'Extension action unavailable, cancelled, expired or rejected';
        }
        await api.completeHostExtensionRequest(state.project.id, hostId, call.id, {
          isError,
          content,
        });
      }
    } catch {
      /* Offline/unavailable is not a successful registration or execution. */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  void tick();
  return {
    dispose() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
