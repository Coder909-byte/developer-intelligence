import type { ToolCategory } from '@udi/contracts';
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  run_engineering_validation: 'hardware_validation',
  get_validation_results: 'hardware_validation',
  get_project_context: 'context_memory',
  get_compressed_context: 'context_memory',
  record_decision: 'context_memory',
  list_project_events: 'context_memory',
  list_available_tools: 'context_memory',
  vscode_execute_command: 'ide_extension_bridge',
  vscode_list_diagnostics: 'ide_extension_bridge',
};
export interface McpToolDefinition {
  name: string;
  category: ToolCategory;
}
export const ALL_TOOLS: McpToolDefinition[] = Object.entries(TOOL_CATEGORIES).map(
  ([name, category]) => ({ name, category }),
);
export function getFilteredTools(activeCategories: Set<ToolCategory>): McpToolDefinition[];
export function getFilteredTools<T extends McpToolDefinition>(
  activeCategories: Set<ToolCategory>,
  tools: T[],
): T[];
export function getFilteredTools(
  activeCategories: Set<ToolCategory>,
  tools: McpToolDefinition[] = ALL_TOOLS,
) {
  return tools.filter((t) => activeCategories.has(t.category));
}
