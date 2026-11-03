import { ValidationRequestBodySchema } from '@udi/contracts';
export function pinValidationInput(text: string) {
  const paths = text
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (
    paths.some(
      (p) =>
        p.startsWith('/') ||
        p.startsWith('\\') ||
        p.includes(':') ||
        p.includes('\0') ||
        p.split(/[\\/]/).includes('..'),
    )
  )
    throw new Error('Use relative workspace artifact paths without parent traversal');
  return ValidationRequestBodySchema.parse({
    kind: 'pin_consistency',
    artifactPaths: paths,
    requestedBy: 'vscode-user',
  });
}
