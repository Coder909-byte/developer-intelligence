import * as vscode from 'vscode';
import { createClient } from '@udi/client-sdk';
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('udi.health', async () => {
      try {
        const baseUrl = vscode.workspace
          .getConfiguration('udi')
          .get<string>('daemonUrl', 'http://127.0.0.1:4317');
        const client = createClient({ baseUrl });
        const result = await client.health();
        await vscode.window.showInformationMessage(
          `Developer Intelligence daemon ${result.version}: ${result.status}`,
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Unable to reach daemon',
        );
      }
    }),
  );
}
export function deactivate() {}
