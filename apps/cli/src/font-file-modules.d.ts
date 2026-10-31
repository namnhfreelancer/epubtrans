/** `import x from './font.ttf' with { type: 'file' }`: Bun resolves the import to the file's path (embedded in compiled binaries). */
declare module '*.ttf' {
  const path: string;
  export default path;
}
